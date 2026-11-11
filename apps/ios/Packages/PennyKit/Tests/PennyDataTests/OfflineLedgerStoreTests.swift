import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("Offline ledger storage")
struct OfflineLedgerStoreTests {
    let directory = Offline.directory()
    let calendar = TestCalendar("2026-11-05")
    let server = FakeLedgerServer()

    func snapshot(_ entries: [LedgerEntry] = [Offline.entry("lunch")], pending: [LedgerEntry] = [])
        -> LocalLedgerSnapshot
    {
        let base = Offline.ledger(entries)
        return LocalLedgerSnapshot(
            base: base, local: Offline.ledger(entries + pending), baseRevision: 7,
            lastSyncedAt: Date(timeIntervalSince1970: 1_800_000_000))
    }

    // MARK: File format

    @Test("whenASnapshotIsSaved_LedgerFileStore_ShouldReadTheSameSnapshotBack")
    func roundTrip() throws {
        let files = LedgerFileStore(directory: directory)
        let saved = snapshot(pending: [Offline.entry("taxi", note: "Crème brûlée ☕️")])
        try files.save(saved, for: Offline.scope())
        #expect(try files.load(Offline.scope()) == saved)
        #expect(try files.load(Offline.scope(Offline.sam)) == nil)
    }

    @Test("whenAFileIsWritten_LedgerFileStore_ShouldUseFormatOneWithTheAccountAndV4Ledgers")
    func formatOne() throws {
        let files = LedgerFileStore(directory: directory)
        try files.save(snapshot(), for: Offline.scope())
        let object = try APIFixtures.object(try Data(contentsOf: files.url(for: Offline.scope())))
        #expect(object["format"] as? Int == 1)
        #expect(object["server"] as? String == "https://penny.example.test")
        #expect(object["email"] as? String == Offline.alex)
        #expect(object["baseRevision"] as? Int == 7)
        #expect((object["base"] as? [String: Any])?["version"] as? Int == 4)
        #expect((object["local"] as? [String: Any])?["version"] as? Int == 4)
        #expect(object["lastSyncedAt"] is String)
    }

    @Test("whenAFileNamesAnotherAccount_LedgerFileStore_ShouldRefuseIt")
    func wrongAccount() throws {
        let files = LedgerFileStore(directory: directory)
        try files.save(snapshot(), for: Offline.scope(Offline.sam))
        try FileManager.default.moveItem(
            at: files.url(for: Offline.scope(Offline.sam)), to: files.url(for: Offline.scope()))
        #expect(throws: LedgerStoreError.wrongAccount) { try files.load(Offline.scope()) }
    }

    @Test("whenAWriteWasInterruptedBeforeTheRename_LedgerFileStore_ShouldStillReadThePreviousFile")
    func interruptedWrite() throws {
        let files = LedgerFileStore(directory: directory)
        let saved = snapshot()
        try files.save(saved, for: Offline.scope())
        // What a crash mid-write leaves: a partial temporary file beside the real one.
        let stray = directory.appendingPathComponent(".\(files.url(for: Offline.scope()).lastPathComponent).x.tmp")
        try Data(#"{"format":1,"server":"#.utf8).write(to: stray)
        #expect(try files.load(Offline.scope()) == saved)
        #expect(files.storedScopes() == [Offline.scope()])
    }

    @Test("whenTheDiskIsFull_LedgerFileStore_ShouldThrowAndKeepThePreviousFile")
    func diskFull() throws {
        let faulty = FaultyFileSystem()
        let files = LedgerFileStore(directory: directory, fileSystem: faulty)
        let saved = snapshot()
        try files.save(saved, for: Offline.scope())
        faulty.failWrites.withLock { $0 = true }
        #expect(throws: LedgerStoreError.writeFailed) {
            try files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        }
        #expect(try files.load(Offline.scope()) == saved)
    }

    @Test("whenTheStoreDirectoryIsCreated_DurableFileSystem_ShouldExcludeItFromBackups")
    func excludedFromBackup() throws {
        let files = LedgerFileStore(directory: directory)
        try files.save(snapshot(), for: Offline.scope())
        #expect(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }

    @Test("whenAccountsAreStored_LedgerFileStore_ShouldListThemAndKeepThemApart")
    func storedScopes() throws {
        let files = LedgerFileStore(directory: directory)
        try files.save(snapshot(), for: Offline.scope())
        try files.save(snapshot([]), for: Offline.scope(Offline.sam))
        #expect(Set(files.storedScopes()) == [Offline.scope(), Offline.scope(Offline.sam)])
        #expect(files.url(for: Offline.scope()) != files.url(for: Offline.scope(Offline.sam)))
        try files.remove(Offline.scope())
        #expect(files.storedScopes() == [Offline.scope(Offline.sam)])
    }

    // MARK: AccountLocalData for sign-out

    @Test("whenChangesArePending_OfflineLedgerStore_ShouldCountThemForSignOut")
    func pendingCount() async throws {
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(pending: [Offline.entry("taxi"), Offline.entry("bus")]), for: Offline.scope())
        #expect(await store.pendingChangeCount(for: Offline.scope()) == 2)
        #expect(await store.pendingChangeCount(for: Offline.scope(Offline.sam)) == 0)
    }

    @Test("whenSyncBeforeSignOutCannotSendEverything_OfflineLedgerStore_ShouldThrowAndKeepTheChanges")
    func syncBeforeSignOutFails() async throws {
        server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch")]), revision: 7)
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        server.outage.withLock { $0 = .offline }
        await #expect(throws: PendingSyncFailed(outcome: .failed(.offline))) {
            try await store.syncPendingChanges(for: Offline.scope(), using: try Offline.client(server))
        }
        #expect(await store.pendingChangeCount(for: Offline.scope()) == 1)

        server.outage.withLock { $0 = nil }
        server.revoke(Offline.alex)
        await #expect(throws: APIError.unauthorized(message: nil)) {
            try await store.syncPendingChanges(for: Offline.scope(), using: try Offline.client(server))
        }

        server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch")]), revision: 7)
        try await store.syncPendingChanges(for: Offline.scope(), using: try Offline.client(server))
        #expect(await store.pendingChangeCount(for: Offline.scope()) == 0)
        #expect(server.ledger(Offline.alex)?.entry(id: "taxi") != nil)
    }

    @Test("whenTheAccountsEmailChanges_OfflineLedgerStore_ShouldMovePendingWorkOntoTheNewScope")
    func moveLocalData() async throws {
        let store = Offline.store(directory, calendar: calendar)
        let newScope = Offline.scope("alex.new@example.test")
        try store.files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        try store.files.save(snapshot([Offline.entry("lunch"), Offline.entry("bus")]), for: newScope)
        try await store.moveLocalData(from: Offline.scope(), to: newScope)
        let moved = try #require(try store.files.load(newScope))
        #expect(moved.local.transactions.map(\.id) == ["lunch", "bus", "taxi"])
        #expect(moved.pending.entryIDs == ["taxi"])
        #expect(try store.files.load(Offline.scope()) == nil)
    }

    @Test("whenASaveArrivesOnTheOldScopeDuringAnEmailMove_OfflineLedgerStore_ShouldRefuseItOrMoveIt")
    func saveDuringMove() async throws {
        let newScope = Offline.scope("alex.new@example.test")
        let gated = GatedFileSystem(holding: LedgerFileStore(directory: directory).url(for: newScope))
        let store = Offline.store(directory, fileSystem: gated, calendar: calendar)
        try store.files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        let move = Task { try await store.moveLocalData(from: Offline.scope(), to: newScope) }
        // The move has its snapshot and is writing it to the new scope.
        await eventually("writing the new scope") { gated.isHolding }
        let old = await store.engine(for: Offline.scope())
        var saved: LocalLedgerSnapshot?
        var refusal: LedgerSaveError?
        do throws(LedgerSaveError) {
            saved = try await old.commit(.saveEntry(Offline.entry("bus")))
        } catch {
            refusal = error
        }
        // The save must have arrived while the move was still waiting. Had the write gone ahead
        // (`timedOut`), the move would have ended first and `engine(for:)` would have made a
        // fresh engine for the emptied old scope, which refuses with `.notLoaded`.
        let heldThroughTheSave = gated.isHolding
        gated.open()
        try await move.value
        try #require(heldThroughTheSave, "the save arrived after the move ended (timed out: \(gated.timedOut))")

        let moved = try #require(try store.files.load(newScope))
        #expect(moved.pending.entryIDs.contains("taxi"))
        #expect(try store.files.load(Offline.scope()) == nil)
        if saved != nil {
            #expect(moved.local.entry(id: "bus") != nil, "a save acknowledged on the old scope must not be lost")
        } else {
            #expect(refusal == .changingEmail, "refused with the reason, so the draft is kept")
        }
    }

    @Test("whenAnEmailMoveFails_OfflineLedgerStore_ShouldKeepTheOldScopeAndTakeSavesAgain")
    func failedMoveLiftsTheHold() async throws {
        let newScope = Offline.scope("alex.new@example.test")
        let failing = GatedFileSystem(holding: LedgerFileStore(directory: directory).url(for: newScope), failing: true)
        let store = Offline.store(directory, fileSystem: failing, calendar: calendar)
        try store.files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        await #expect(throws: LedgerStoreError.writeFailed) {
            try await store.moveLocalData(from: Offline.scope(), to: newScope)
        }
        let old = await store.engine(for: Offline.scope())
        try await old.commit(.saveEntry(Offline.entry("bus")))
        #expect(try store.files.load(Offline.scope())?.pending.entryIDs == ["taxi", "bus"])
        #expect(try store.files.load(newScope) == nil)
    }

    @Test("whenSigningOut_LedgerSyncEngine_ShouldRefuseSavesFromTheCountUntilRemovedOrCancelled")
    func removalHoldsSaves() async throws {
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(pending: [Offline.entry("taxi")]), for: Offline.scope())
        #expect(await store.beginRemoval(for: Offline.scope()) == 1)
        let engine = await store.engine(for: Offline.scope())
        await #expect(throws: LedgerSaveError.signingOut) { try await engine.commit(.saveEntry(Offline.entry("bus"))) }
        #expect(await store.pendingChangeCount(for: Offline.scope()) == 1, "nothing landed after the count")

        await store.cancelRemoval(for: Offline.scope())
        try await engine.commit(.saveEntry(Offline.entry("bus")))
        #expect(await store.pendingChangeCount(for: Offline.scope()) == 2)
    }

    @Test("whenAWriteWasInterruptedBeforeSignOut_OfflineLedgerStore_ShouldRemoveItsTemporaryFilesToo")
    func removalDeletesTemporaryFiles() async throws {
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(), for: Offline.scope())
        try store.files.save(snapshot(), for: Offline.scope(Offline.sam))
        let mine = ".\(store.files.url(for: Offline.scope()).lastPathComponent).\(UUID().uuidString).tmp"
        try Data(#"{"format":1,"server":"#.utf8).write(to: directory.appendingPathComponent(mine))
        try await store.removeLocalData(for: Offline.scope())
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: directory.path) == [
                store.files.url(for: Offline.scope(Offline.sam)).lastPathComponent
            ])
    }

    @Test("whenTheStoreOpensWithStaleTemporaryFiles_OfflineLedgerStore_ShouldSweepThem")
    func openingSweepsTemporaryFiles() throws {
        let files = LedgerFileStore(directory: directory)
        try files.save(snapshot(), for: Offline.scope())
        let name = files.url(for: Offline.scope()).lastPathComponent
        // Left by a crash an hour ago, and one a write in progress has just created.
        let stale = directory.appendingPathComponent(".\(name).\(UUID().uuidString).tmp")
        let inProgress = directory.appendingPathComponent(".\(name).\(UUID().uuidString).tmp")
        try Data("partial".utf8).write(to: stale)
        try Data("partial".utf8).write(to: inProgress)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: stale.path)
        _ = Offline.store(directory, calendar: calendar)
        #expect(
            Set(try FileManager.default.contentsOfDirectory(atPath: directory.path)) == [
                name, inProgress.lastPathComponent,
            ])
        #expect(try files.load(Offline.scope()) == snapshot())
    }

    @Test("whenTwoCopiesAreSetAsideInTheSameSecond_LedgerFileStore_ShouldKeepBoth")
    func setAsideTwiceInOneSecond() throws {
        // The store's clock is fixed, so both moves happen "in the same second".
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(), for: Offline.scope())
        let first = try store.files.setAside(Offline.scope())
        try store.files.save(snapshot(), for: Offline.scope())
        let second = try store.files.setAside(Offline.scope())
        #expect(first != second)
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        #expect(names.filter { $0.contains(".unreadable-") }.count == 2)
        #expect(try store.files.load(Offline.scope()) == nil, "the account starts again from the server")
    }

    @Test("whenTheAccountIsRemoved_OfflineLedgerStore_ShouldDeleteItsFilesIncludingSetAsideCopies")
    func removeLocalData() async throws {
        let store = Offline.store(directory, calendar: calendar)
        try store.files.save(snapshot(), for: Offline.scope())
        try store.files.setAside(Offline.scope())
        try store.files.save(snapshot(), for: Offline.scope())
        try store.files.save(snapshot(), for: Offline.scope(Offline.sam))
        try await store.removeLocalData(for: Offline.scope())
        #expect(store.storedScopes() == [Offline.scope(Offline.sam)])
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).count == 1)
    }
}
