import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

@Suite("Offline ledger sync engine")
struct LedgerSyncEngineTests {
    let server = FakeLedgerServer()
    let directory = Offline.directory()
    let calendar = TestCalendar("2026-11-05")

    init() {
        server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch", title: "Lunch")]))
    }

    func engine(
        fileSystem: any LedgerFileSystem = DurableFileSystem(), retry: ConflictRetryPolicy = .immediate()
    ) async -> LedgerSyncEngine {
        await Offline.store(directory, fileSystem: fileSystem, calendar: calendar, retry: retry).engine(
            for: Offline.scope())
    }

    func synced() async throws -> LedgerSyncEngine {
        let engine = await engine()
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        return engine
    }

    // MARK: Relaunch and offline work

    @Test("whenSavedOfflineAndTheProcessIsKilled_Engine_ShouldKeepPendingWorkAfterRelaunch")
    func relaunchKeepsPendingWork() async throws {
        let engine = try await synced()
        server.outage.withLock { $0 = .offline }
        try await engine.commit(.saveEntry(Offline.entry("taxi", title: "Taxi")))
        let lunch = try #require(server.ledger(Offline.alex)?.entry(id: "lunch"))
        var edited = lunch
        edited.note = "With Sam"
        try await engine.commit(.saveEntry(edited, original: lunch))
        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.offline))

        // A new process: nothing in memory, only the files on disk.
        let relaunched = await self.engine()
        #expect(await relaunched.load() == .ready)
        let snapshot = try #require(await relaunched.state.snapshot)
        #expect(snapshot.pending.entryIDs == ["taxi", "lunch"])
        #expect(snapshot.local.entry(id: "lunch")?.note == "With Sam")

        server.outage.withLock { $0 = nil }
        #expect(await relaunched.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex) == (await relaunched.state.snapshot?.local))
        #expect(server.ledger(Offline.alex)?.entry(id: "lunch")?.note == "With Sam")
        #expect(await relaunched.pendingChangeCount() == 0)
    }

    @Test("whenEntriesAreCreatedEditedAndDeletedOffline_Engine_ShouldConvergeWithTheServer")
    func offlineCreateEditDelete() async throws {
        let engine = try await synced()
        server.outage.withLock { $0 = .offline }
        let lunch = try #require(await engine.state.snapshot?.local.entry(id: "lunch"))
        try await engine.commit(.saveEntry(Offline.entry("taxi", title: "Taxi")))
        try await engine.commit(.deleteEntry(lunch))
        let taxi = try #require(await engine.state.snapshot?.local.entry(id: "taxi"))
        var edited = taxi
        edited.share = 2000
        edited.total = 2000
        try await engine.commit(.saveEntry(edited, original: taxi))
        #expect(await engine.state.pending.count == 2)

        server.outage.withLock { $0 = nil }
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex)?.transactions.map(\.id) == ["taxi"])
        #expect(server.ledger(Offline.alex)?.entry(id: "taxi")?.share == 2000)
    }

    @Test("whenTheFirstDownloadHasNotHappened_Engine_ShouldRefuseToSave")
    func saveBeforeFirstDownload() async throws {
        let engine = await engine()
        await #expect(throws: LedgerSaveError.notLoaded) {
            try await engine.commit(.saveEntry(Offline.entry("taxi")))
        }
    }

    @Test("whenAChangeBreaksALedgerRule_Engine_ShouldRefuseItAndKeepTheLedger")
    func ruleRefusal() async throws {
        let engine = try await synced()
        let before = await engine.state.snapshot
        var stale = Offline.entry("lunch", title: "Not what is stored")
        stale.note = "x"
        await #expect(throws: LedgerSaveError.rule(.entryChangedOnAnotherDevice)) {
            try await engine.commit(.saveEntry(Offline.entry("lunch", title: "New"), original: stale))
        }
        #expect(await engine.state.snapshot == before)
    }

    // MARK: Disk failures

    @Test("whenTheDiskWriteFails_Engine_ShouldNotAcknowledgeTheSave")
    func failedWriteOnSave() async throws {
        let files = FaultyFileSystem()
        let engine = await engine(fileSystem: files)
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        let before = await engine.state.snapshot

        files.failWrites.withLock { $0 = true }
        await #expect(throws: LedgerSaveError.writeFailed) {
            try await engine.commit(.saveEntry(Offline.entry("taxi")))
        }
        #expect(await engine.state.snapshot == before)
        let relaunched = await self.engine()
        await relaunched.load()
        #expect(await relaunched.state.snapshot == before)
    }

    @Test("whenTheDiskWriteFailsAfterTheServerAccepted_Engine_ShouldConvergeWithoutDuplicates")
    func failedWriteAfterPut() async throws {
        let files = FaultyFileSystem()
        let engine = await engine(fileSystem: files)
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        try await engine.commit(.saveEntry(Offline.entry("taxi")))

        files.failWrites.withLock { $0 = true }
        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.storageWriteFailed))
        #expect(server.ledger(Offline.alex)?.transactions.map(\.id) == ["lunch", "taxi"])
        #expect(await engine.state.pending.entryIDs == ["taxi"])

        files.failWrites.withLock { $0 = false }
        let revision = server.revision(Offline.alex)
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.revision(Offline.alex) == revision, "the repeat sync wrote nothing new")
        #expect(server.ledger(Offline.alex)?.transactions.map(\.id) == ["lunch", "taxi"])
        #expect(await engine.state.pending.isEmpty)
    }

    @Test("whenTheCopyOnDiskIsCorrupt_Engine_ShouldKeepItRefuseSavesAndRecoverOnRequest")
    func corruptCache() async throws {
        let engine = try await synced()
        let file = Offline.store(directory, calendar: calendar).files.url(for: Offline.scope())
        try Data(#"{"format":1,"server":"https://penny.example.test","email":"alex@exa"#.utf8).write(to: file)

        let relaunched = await self.engine()
        #expect(await relaunched.load() == .unreadable)
        #expect(await relaunched.pendingChangeCount() == 1, "an unreadable copy is never removed silently")
        await #expect(throws: LedgerSaveError.storageUnreadable) {
            try await relaunched.commit(.saveEntry(Offline.entry("taxi")))
        }
        #expect(await relaunched.sync(using: try Offline.client(server)) == .notReady)
        #expect(server.log.all.filter { $0 == "PUT /api/ledger" }.isEmpty)

        #expect(await relaunched.recoverUnreadableCopy(using: try Offline.client(server)) == .synced)
        #expect(await relaunched.state.snapshot?.local == server.ledger(Offline.alex))
        let kept = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        #expect(kept.contains { $0.contains(".unreadable-") }, "the damaged file is kept aside")
        _ = engine
    }

    @Test("whenTheCopyWasWrittenByANewerApp_Engine_ShouldLeaveItAlone")
    func newerFormat() async throws {
        _ = try await synced()
        let file = Offline.store(directory, calendar: calendar).files.url(for: Offline.scope())
        try Data(#"{"format":2,"server":"https://penny.example.test","email":"alex@example.test"}"#.utf8)
            .write(to: file)
        let relaunched = await self.engine()
        #expect(await relaunched.load() == .newerFormat(2))
        #expect(await relaunched.recoverUnreadableCopy(using: try Offline.client(server)) == .notReady)
        #expect(try Data(contentsOf: file).count > 0)
    }

    @Test("whenTheDeviceIsLocked_Engine_ShouldReadTheCopyAgainLaterWithoutTreatingItAsCorrupt")
    func lockedFile() async throws {
        _ = try await synced()
        let files = FaultyFileSystem()
        files.failReads.withLock { $0 = true }
        let relaunched = await self.engine(fileSystem: files)
        #expect(await relaunched.load() == .unavailable)
        files.failReads.withLock { $0 = false }
        #expect(await relaunched.load() == .ready)
        #expect(await relaunched.state.snapshot != nil)
    }

    // MARK: Conflicts

    @Test("whenTheWebEditsAnotherFieldBetweenReadAndWrite_Engine_ShouldRetryAndKeepBothEdits")
    func conflictKeepsIndependentEdits() async throws {
        let engine = try await synced()
        let lunch = try #require(await engine.state.snapshot?.local.entry(id: "lunch"))
        var edited = lunch
        edited.note = "From the phone"
        try await engine.commit(.saveEntry(edited, original: lunch))
        server.beforePut.withLock {
            $0 = [{ [server] in server.edit(Offline.alex) { $0.transactions[0].title = "Web lunch" } }]
        }

        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        let stored = try #require(server.ledger(Offline.alex)?.entry(id: "lunch"))
        #expect(stored.title == "Web lunch")
        #expect(stored.note == "From the phone")
        #expect(server.log.all.filter { $0 == "PUT /api/ledger" }.count == 2)
    }

    @Test("whenBothDevicesEditTheSameField_Engine_ShouldApplyTheDocumentedLocalWinsPolicy")
    func sameFieldPolicy() async throws {
        let engine = try await synced()
        let lunch = try #require(await engine.state.snapshot?.local.entry(id: "lunch"))
        var edited = lunch
        edited.title = "Phone title"
        try await engine.commit(.saveEntry(edited, original: lunch))
        server.edit(Offline.alex) { $0.transactions[0].title = "Web title" }
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex)?.entry(id: "lunch")?.title == "Phone title")
    }

    @Test("whenEveryWriteMeetsANewerRevision_Engine_ShouldStopAfterTheLimitKeepWorkAndSucceedLater")
    func repeatedConflicts() async throws {
        let engine = await engine(retry: .immediate(maxAttempts: 3))
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        try await engine.commit(.saveEntry(Offline.entry("taxi", title: "Taxi")))
        let race: @Sendable () -> Void = { [server] in server.edit(Offline.alex) { $0.transactions[0].note += "." } }
        server.beforePut.withLock { $0 = [race, race, race] }

        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.conflictRetriesExhausted))
        #expect(server.log.all.filter { $0 == "PUT /api/ledger" }.count == 3)
        #expect(await engine.state.pending.entryIDs == ["taxi"])
        #expect(server.ledger(Offline.alex)?.entry(id: "taxi") == nil)

        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex)?.entry(id: "taxi") != nil)
        #expect(server.ledger(Offline.alex)?.entry(id: "lunch")?.note == "...")
    }

    @Test("whenTwoSyncsAreRequestedAtOnce_Engine_ShouldRunOneAndShareItsResult")
    func serializedSyncs() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        let gate = server.hold("GET /api/ledger")
        let client = try Offline.client(server)
        async let first = engine.sync(using: client)
        async let second = engine.sync(using: client)
        try await Task.sleep(for: .milliseconds(50))
        gate.open()
        #expect(await first == .synced)
        #expect(await second == .synced)
        #expect(server.log.all.filter { $0 == "PUT /api/ledger" }.count == 1)
    }

    @Test("whenTheDeviceSavesWhileASyncIsRunning_Engine_ShouldKeepTheSaveAndSyncItInASecondPass")
    func saveDuringSync() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        let gate = server.hold("PUT /api/ledger")
        let syncing = Task { await engine.sync(using: try Offline.client(server)) }
        try await Task.sleep(for: .milliseconds(50))
        try await engine.commit(.saveEntry(Offline.entry("bus", title: "Bus")))
        gate.open()
        #expect(try await syncing.value == .synced)
        #expect(server.ledger(Offline.alex)?.transactions.map(\.id) == ["lunch", "taxi", "bus"])
        #expect(await engine.state.pending.isEmpty)
    }

    // MARK: Server and session failures

    @Test("whenTheSessionHasExpired_Engine_ShouldReportItAndKeepEveryChange")
    func sessionExpiry() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        server.revoke(Offline.alex)
        #expect(await engine.sync(using: try Offline.client(server)) == .sessionExpired)
        #expect(await engine.state.pending.entryIDs == ["taxi"])
    }

    @Test("whenTheServerIsUnavailableThenRestarts_Engine_ShouldReportItThenConverge")
    func serverRestart() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        server.fail("PUT /api/ledger", with: .status(503, retryAfter: 30))
        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.serverUnavailable(retryAfter: 30)))
        server.outage.withLock { $0 = .timeout }
        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.serverUnreachable))
        server.outage.withLock { $0 = nil }
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex)?.transactions.map(\.id) == ["lunch", "taxi"])
    }

    @Test("whenTheServerRefusesTheLedger_Engine_ShouldReportTheMessageAndKeepTheChange")
    func rejected() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        server.fail("PUT /api/ledger", with: .status(400))
        #expect(await engine.sync(using: try Offline.client(server)) == .failed(.rejected(message: "Fault 400")))
        #expect(await engine.state.pending.entryIDs == ["taxi"])
    }

    @Test("whenTheServerSendsALedgerVersionThisBuildDoesNotKnow_Engine_ShouldWriteNothing")
    func incompatibleServerData() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        let future =
            #"{"revision":9,"ledger":{"version":5,"currency":"CAD","categories":[],"transactions":[],"recurring":[]}}"#
        let transport = StubTransport(json: future)
        let client = try APIFixtures.client(
            session: try ServerSession(
                server: APIFixtures.server, email: Offline.alex, token: server.token(for: Offline.alex)),
            transport: transport)
        #expect(await engine.sync(using: client) == .failed(.incompatibleServerData))
        #expect(transport.paths() == ["GET /api/ledger"])
        #expect(await engine.state.pending.entryIDs == ["taxi"])
    }

    // MARK: Accounts

    @Test("whenGivenAnotherAccountsClient_Engine_ShouldSendNothing")
    func wrongAccountClient() async throws {
        server.addAccount(Offline.sam)
        let engine = await engine()
        #expect(await engine.sync(using: try Offline.client(server, email: Offline.sam)) == .notReady)
        #expect(server.log.all.isEmpty)
    }

    @Test("whenTheAccountIsRemovedWhileASyncIsInFlight_Engine_ShouldNotRecreateItsData")
    func removalDuringSync() async throws {
        let engine = try await synced()
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        let gate = server.hold("GET /api/ledger")
        let syncing = Task { await engine.sync(using: try Offline.client(server)) }
        try await Task.sleep(for: .milliseconds(50))
        try await engine.remove()
        gate.open()
        let outcome = try await syncing.value
        #expect(outcome == .cancelled || outcome == .notReady)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
        #expect(server.ledger(Offline.alex)?.entry(id: "taxi") == nil)
    }

    // MARK: Dates and recurrence

    @Test("whenTheDayChangesAndAnotherDeviceAlsoRecorded_Engine_ShouldConvergeWithoutDuplicateOccurrences")
    func recurrenceAcrossDevicesAndMidnight() async throws {
        server.edit(Offline.alex) { $0.recurring = [Offline.rule("rent", next: "2026-11-06")] }
        calendar.set("2026-11-05")
        let engine = try await synced()
        #expect(await engine.state.snapshot?.local.transactions.count == 1)

        // Offline over midnight: the phone records the 6th itself.
        server.outage.withLock { $0 = .offline }
        calendar.set("2026-11-06")
        await engine.materializeDueOccurrences()
        #expect(await engine.state.pending.entryIDs == ["rent:2026-11-06"])

        // Meanwhile the web recorded it too, and edited the occurrence's note.
        server.edit(Offline.alex) { ledger in
            ledger = Recurrence.materialize(ledger, today: .day("2026-11-06"))
            if let index = ledger.transactions.firstIndex(where: { $0.id == "rent:2026-11-06" }) {
                ledger.transactions[index].note = "Paid"
            }
        }
        server.outage.withLock { $0 = nil }
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        let ledger = try #require(server.ledger(Offline.alex))
        #expect(ledger.transactions.filter { $0.recurringId == "rent" }.count == 1)
        #expect(ledger.entry(id: "rent:2026-11-06")?.note == "Paid")
        #expect(ledger.rule(id: "rent")?.nextDate == .day("2026-12-01"))
        #expect(await engine.state.snapshot?.local == ledger)

        // Running again on the same day adds nothing.
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex) == ledger)
    }

    @Test("whenTheWebDeletedAnOccurrenceThePhoneAlsoRecordedOffline_Engine_ShouldNotResurrectIt")
    func deletedOccurrenceStaysDeleted() async throws {
        server.edit(Offline.alex) { $0.recurring = [Offline.rule("rent", next: "2026-11-06")] }
        let engine = try await synced()
        calendar.set("2026-11-07")
        server.outage.withLock { $0 = .offline }
        await engine.materializeDueOccurrences()
        server.edit(Offline.alex) { ledger in
            ledger = Recurrence.materialize(ledger, today: .day("2026-11-06"))
            ledger.transactions.removeAll { $0.id == "rent:2026-11-06" }
        }
        server.outage.withLock { $0 = nil }
        #expect(await engine.sync(using: try Offline.client(server)) == .synced)
        #expect(server.ledger(Offline.alex)?.entry(id: "rent:2026-11-06") == nil)
        #expect(await engine.state.snapshot?.local.entry(id: "rent:2026-11-06") == nil)
    }
}
