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
