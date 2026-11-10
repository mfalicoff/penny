import Foundation
import PennyDomain
import Security
import Testing

@testable import PennyData

@Suite("Expo storage formats")
struct ExpoLegacyFormatTests {
    @Test("whenAKeyIsScopedToAServer_ExpoLegacyFormat_ShouldSplitItEvenWhenTheEmailHasDots")
    func scopes() {
        let server = "https://other.example.test:8443"
        let key = ExpoLegacyFormat.storageKey(
            "penny:ledger:first.last@mail.example.test", server: server, legacyServer: "https://penny.example.test")
        #expect(key.hasSuffix("." + ExpoLegacyFormat.scopeSuffix(server)))
        let split = ExpoLegacyFormat.split(key)
        #expect(split.name == "penny:ledger:first.last@mail.example.test")
        #expect(split.server == server)
        let unscoped = ExpoLegacyFormat.split("penny:ledger:first.last@mail.example.test")
        #expect(unscoped.name == "penny:ledger:first.last@mail.example.test")
        #expect(unscoped.server == nil)
        #expect(ExpoLegacyFormat.split("penny-session").server == nil)
        // The original server keeps the unscoped key (serverStorageKey).
        #expect(
            ExpoLegacyFormat.storageKey("penny-session", server: "https://a.test", legacyServer: "https://a.test")
                == "penny-session")
        // Not a URL after the dot, or not encoded the way the Expo app encodes: no server.
        #expect(ExpoLegacyFormat.split("penny:active-account.68.74.74.70").server == nil)
        #expect(ExpoLegacyFormat.split("penny:active-account.68.74.74.70.73.3A.2f.2f.61.2e.74").server == nil)
    }

    @Test("whenTheExpoAppScopedAKey_ExpoLegacyFormat_ShouldMatchTheJavaScriptEncoding")
    func javascriptEncoding() {
        // Array.from(url, c => c.codePointAt(0).toString(16)).join(".") for this URL.
        #expect(
            ExpoLegacyFormat.scopeSuffix("http://localhost:3001")
                == "68.74.74.70.3a.2f.2f.6c.6f.63.61.6c.68.6f.73.74.3a.33.30.30.31")
    }

    @Test("whenALedgerRecordIsVersionThree_ExpoLegacyFormat_ShouldUpgradeItAsTheServerDoes")
    func upgradesOldVersions() throws {
        // As JSON.stringify wrote it: no accounts or trips before version 3.
        let ledger = #"""
            {"version":2,"currency":"CAD","categories":[{"id":"food","name":"Food & drinks","icon":"cafe-outline",
            "color":"#E47850","kind":"expense"}],"transactions":[{"id":"t1","title":"Café","kind":"expense",
            "total":1250,"share":1250,"categoryId":"food","date":"2026-10-20","note":""}],"recurring":[]}
            """#
        let pair = try #require(ExpoLegacyFormat.ledger(#"{"base":\#(ledger),"local":\#(ledger)}"#))
        #expect(pair.local.transactions.map(\.title) == ["Café"])
        #expect(pair.base == pair.local)
        #expect(ExpoLegacyFormat.ledger(#"{"base":\#(ledger)}"#) == nil, "half a record")
        #expect(ExpoLegacyFormat.ledger(#"{"base":{"version":99},"local":{"version":99}}"#) == nil)
        #expect(ExpoLegacyFormat.ledger("not json") == nil)
    }
}

@Suite("Expo AsyncStorage and SecureStore")
struct ExpoSourceTests {
    let install = ExpoInstall()

    @Test("whenAValueIsLong_ExpoAsyncStorage_ShouldUseAnMD5NamedFileAsAsyncStorageDoes")
    func overflowFiles() throws {
        let long = String(repeating: "x", count: 1025)
        try install.asyncStorage.set(["penny:ledger:alex@example.test": long, "short": "value"])
        // RCTMD5Hash("penny:ledger:alex@example.test"), checked with `md5 -s`.
        let file = install.storeDirectory.appendingPathComponent("638a4511b64afa61d69785c26a711de3")
        #expect(try String(contentsOf: file, encoding: .utf8) == long)
        let manifest = try APIFixtures.object(
            try Data(contentsOf: install.storeDirectory.appendingPathComponent("manifest.json")))
        #expect(manifest["penny:ledger:alex@example.test"] is NSNull)
        #expect(manifest["short"] as? String == "value")
        #expect(try install.storedValues() == ["penny:ledger:alex@example.test": long, "short": "value"])

        try install.asyncStorage.remove(["penny:ledger:alex@example.test"])
        #expect(!FileManager.default.fileExists(atPath: file.path))
        #expect(try install.storedValues() == ["short": "value"])
    }

    @Test("whenTheManifestIsDamaged_ExpoAsyncStorage_ShouldReportItAndKeepIt")
    func corruptManifest() throws {
        try FileManager.default.createDirectory(at: install.storeDirectory, withIntermediateDirectories: true)
        let manifest = install.storeDirectory.appendingPathComponent("manifest.json")
        try Data("{\"penny:".utf8).write(to: manifest)
        #expect(throws: ExpoStoreError.corrupt) { try install.asyncStorage.load() }
        #expect(throws: ExpoStoreError.corrupt) { try install.asyncStorage.remove(["penny:server-connection"]) }
        #expect(try Data(contentsOf: manifest) == Data("{\"penny:".utf8))
    }

    @Test("whenOnlyTheDeprecatedDirectoryExists_ExpoAsyncStorage_ShouldReadIt")
    func deprecatedLocation() throws {
        try FileManager.default.createDirectory(at: install.deprecatedDirectory, withIntermediateDirectories: true)
        try Data(#"{"penny:active-account":"alex@example.test"}"#.utf8)
            .write(to: install.deprecatedDirectory.appendingPathComponent("manifest.json"))
        #expect(try install.storedValues() == ["penny:active-account": "alex@example.test"])
    }

    @Test("whenThereIsNoStore_ExpoAsyncStorage_ShouldReadNothing")
    func noStore() throws {
        #expect(try install.asyncStorage.load() == nil)
        try install.asyncStorage.remove(["anything"])
        #expect(install.asyncStorage.directory == nil, "removing never creates a store")
    }

    @Test("whenSecureStoreWroteAnItem_ExpoSecureStore_ShouldReadBothServicesAndRemoveThem")
    func secureStore() throws {
        try install.secureStore.set("dark", forKey: "penny-theme")
        #expect(install.keychain.value("penny-theme") == "dark")
        #expect(try install.secureStore.string(forKey: "penny-theme") == "dark")
        install.keychain.putLegacy("true", forKey: "penny-app-lock")
        #expect(try install.secureStore.string(forKey: "penny-app-lock") == "true")
        #expect(try install.secureStore.string(forKey: "penny-session") == nil)
        try install.secureStore.remove("penny-app-lock")
        #expect(try install.secureStore.string(forKey: "penny-app-lock") == nil)

        install.keychain.forcedStatus.withLock { $0 = errSecInteractionNotAllowed }
        #expect(throws: ExpoStoreError.unavailable) { try install.secureStore.string(forKey: "penny-theme") }
    }
}

@Suite("Expo in-place import")
struct ExpoMigrationTests {
    let install = ExpoInstall()
    let alex = Offline.alex
    let sam = Offline.sam
    let server = APIFixtures.server
    let other = APIFixtures.serverURL(ExpoInstall.otherServer)

    var synced: PennyDomain.Ledger { Offline.ledger([Offline.entry("lunch")]) }
    var withPending: PennyDomain.Ledger { Offline.ledger([Offline.entry("lunch"), Offline.entry("taxi", title: "Taxi")]) }

    /// A typical Expo install: lock on, AMOLED theme, one signed-in account with an unsynced entry.
    func stageTypicalInstall(token: String = APIFixtures.token) throws {
        try install.stageServer()
        try install.stageLedger(alex, base: synced, local: withPending)
        try install.stageAccount(alex, token: token)
        try install.secureStore.set("amoled", forKey: ExpoLegacyFormat.themeKey)
        try install.secureStore.set("true", forKey: ExpoLegacyFormat.lockKey)
    }

    // MARK: First launch

    @Test("whenAnExpoInstallHasUnsyncedEntries_ExpoMigration_ShouldImportThemAsPendingChanges")
    func importsEverything() throws {
        try stageTypicalInstall()
        let report = install.migration().run()

        #expect(report.status == .waitingForSync)
        let snapshot = try #require(try install.ledgers.load(Offline.scope()))
        #expect(snapshot.base == synced)
        #expect(snapshot.local == withPending)
        #expect(snapshot.pending.entryIDs == ["taxi"])
        #expect(snapshot.lastSyncedAt == nil)
        #expect(report.accounts.map(\.outcome) == [.imported(pendingChanges: 1)])
        #expect(try install.lock.read(), "the lock stays on")
        #expect(install.device.appearance == .dark, "AMOLED becomes dark")
        #expect(install.auth.savedServer() == SavedServer(server: server, version: "1.0.0"))
        let session = try #require(try install.sessions.load(server: server))
        #expect(session.email == alex)
        #expect(session.tokenForStorage == APIFixtures.token)
        #expect(install.auth.hasLaunchedBefore)
        // Nothing is removed before the account syncs.
        #expect(try install.storedValues().count == 3)
        #expect(install.keychain.count == 3)
        #expect(!report.lines.joined().contains(alex), "diagnostic lines leave emails out")
        #expect(!report.lines.joined().contains(APIFixtures.token))
    }

    @Test("whenNoExpoDataExists_ExpoMigration_ShouldReportNothingToImportAndChangeNothing")
    func freshInstall() throws {
        let report = install.migration().run()
        #expect(report.status == .nothingToImport)
        #expect(install.device.appearance == .system)
        #expect(try install.lock.read() == false)
        #expect(install.auth.savedServer() == nil)
        #expect(install.auth.hasLaunchedBefore == false, "the sign-in purge still runs as for any install")
        #expect(install.migration().journal().finishedAt != nil)
        #expect(install.migration().run().status == .nothingToImport)
        #expect(install.asyncStorage.directory == nil)
    }

    // MARK: Repeated and interrupted launches

    @Test("whenLaunchedAgain_ExpoMigration_ShouldNotImportTwiceOrUndoNativeEdits")
    func repeatedLaunch() async throws {
        try stageTypicalInstall()
        install.migration().run()
        let store = Offline.store(install.root.appending(path: "Ledgers"), calendar: TestCalendar("2026-11-05"))
        try await store.engine(for: Offline.scope()).commit(.deleteEntry(Offline.entry("taxi", title: "Taxi")))
        let edited = try #require(try install.ledgers.load(Offline.scope()))

        install.advance(60)
        let report = install.migration().run()
        #expect(report.accounts.map(\.outcome) == [.waitingForSync])
        #expect(try install.ledgers.load(Offline.scope()) == edited, "the deleted entry does not come back")
    }

    @Test("whenTheImportWasInterruptedBeforeItsJournalWasSaved_ExpoMigration_ShouldResumeWithoutDuplicates")
    func interrupted() throws {
        try stageTypicalInstall()
        install.migration().run()
        let imported = try install.ledgers.load(Offline.scope())
        // What a crash right after the ledger write leaves: the ledger, but no journal.
        try FileManager.default.removeItem(at: install.journalURL)

        let report = install.migration().run()
        #expect(report.accounts.map(\.outcome) == [.alreadyImported])
        #expect(try install.ledgers.load(Offline.scope()) == imported)
        #expect(install.migration().journal().ledgers[install.ledgerKey(alex)] != nil)
    }

    @Test("whenTheJournalIsDamaged_ExpoMigration_ShouldStartItAgainWithoutLosingAnything")
    func damagedJournal() throws {
        try stageTypicalInstall()
        install.migration().run()
        try Data("{".utf8).write(to: install.journalURL)
        let report = install.migration().run()
        #expect(report.notes.contains(.journalReset))
        #expect(report.accounts.map(\.outcome) == [.alreadyImported])
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending)
    }

    @Test("whenANativeLedgerAlreadyExists_ExpoMigration_ShouldMergeTheExpoChangesOntoIt")
    func mergesOntoNative() throws {
        try stageTypicalInstall()
        let native = Offline.ledger([Offline.entry("lunch"), Offline.entry("rent", title: "Rent")])
        try install.ledgers.save(
            LocalLedgerSnapshot(
                base: native, local: native, baseRevision: 9, lastSyncedAt: Date(timeIntervalSince1970: 1)),
            for: Offline.scope())

        let report = install.migration().run()
        #expect(report.accounts.map(\.outcome) == [.merged(pendingChanges: 1)])
        let snapshot = try #require(try install.ledgers.load(Offline.scope()))
        #expect(snapshot.base == native, "the native base and revision are kept")
        #expect(snapshot.baseRevision == 9)
        #expect(Set(snapshot.local.transactions.map(\.id)) == ["lunch", "rent", "taxi"])
    }

    @Test("whenTheExpoLedgerHasNoUnsyncedChanges_ExpoMigration_ShouldNotTouchANewerNativeLedger")
    func keepsNewerNative() throws {
        try install.stageServer()
        try install.stageLedger(alex, base: synced, local: synced)
        let native = Offline.ledger([Offline.entry("rent")])
        let snapshot = LocalLedgerSnapshot(base: native, local: native, baseRevision: 3, lastSyncedAt: nil)
        try install.ledgers.save(snapshot, for: Offline.scope())
        #expect(install.migration().run().accounts.map(\.outcome) == [.alreadyImported])
        #expect(try install.ledgers.load(Offline.scope()) == snapshot)
    }

    @Test("whenTheExpoBuildWroteAgainAfterARollback_ExpoMigration_ShouldImportOnlyTheNewChanges")
    func rollback() throws {
        try stageTypicalInstall()
        install.migration().run()
        // The person went back to the Expo build, which synced the taxi and saved a new entry offline.
        try install.stageLedger(
            alex, base: withPending, local: Offline.ledger([Offline.entry("lunch"), Offline.entry("taxi", title: "Taxi"),
            Offline.entry("cinema")]))
        install.advance(60)
        let report = install.migration().run()
        #expect(report.accounts.map(\.outcome) == [.merged(pendingChanges: 1)])
        #expect(try install.ledgers.load(Offline.scope())?.local.transactions.map(\.id).sorted() == ["cinema", "lunch", "taxi"])
        #expect(install.migration().run().accounts.map(\.outcome) == [.waitingForSync])
    }

    // MARK: Accounts and servers

    @Test("whenSeveralAccountsAndServersHaveLedgers_ExpoMigration_ShouldImportEachUnderItsOwnScope")
    func multipleAccounts() throws {
        // The person moved from the original server to another one; alex's session on the
        // original server had expired (the Expo app forgot the account but kept its entries),
        // and sam is signed in on the other server.
        try install.stageServer(url: ExpoInstall.otherServer)
        try install.stageLedger(alex, base: synced, local: withPending)
        try install.stageLedger("Sam@Example.test", server: ExpoInstall.otherServer, base: synced, local: synced)
        try install.stageAccount("Sam@Example.test", server: ExpoInstall.otherServer, token: ExpoInstall.otherToken)

        let report = install.migration().run()
        #expect(report.status == .waitingForSync)
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending)
        #expect(try install.ledgers.load(AccountScope(server: other, email: sam))?.local == synced)
        #expect(install.auth.savedServer()?.server == other, "the server the person chose last")
        #expect(try install.sessions.load(server: other)?.email == "Sam@Example.test")
        #expect(try install.sessions.load(server: server) == nil)
        #expect(Set(report.accounts.map(\.server)) == [server.description, other.description])
    }

    @Test("whenATokenHasNoKnownAccount_ExpoMigration_ShouldAskForSignInAndKeepTheEntries")
    func tokenWithoutAccount() throws {
        try install.stageServer()
        try install.stageLedger(alex, base: synced, local: withPending)
        try install.secureStore.set(APIFixtures.token, forKey: ExpoLegacyFormat.sessionKey)
        let report = install.migration().run()
        #expect(report.notes.contains(.sessionNeedsSignIn(server: server.description)))
        #expect(try install.sessions.load(server: server) == nil)
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending)
    }

    @Test("whenANativeSessionOrServerAlreadyExists_ExpoMigration_ShouldNotReplaceIt")
    func keepsNativeChoices() throws {
        try stageTypicalInstall()
        let chosen = SavedServer(server: other, version: "2.0.0")
        try install.auth.setSavedServer(chosen)
        install.auth.markLaunched()
        let native = try ServerSession(server: server, email: sam, token: ExpoInstall.otherToken)
        try install.sessions.save(native)

        install.migration().run()
        #expect(install.auth.savedServer() == chosen)
        #expect(try install.sessions.load(server: server) == native)
    }

    @Test("whenTheFirstNativeLaunchImportsASession_ExpoMigration_ShouldPurgeLeftoversButKeepTheImportedOne")
    @MainActor
    func purgeThenImport() async throws {
        let ledgerServer = FakeLedgerServer()
        let token = ledgerServer.addAccount(alex, ledger: synced)
        try stageTypicalInstall(token: token)
        // A session a deleted native install left in the Keychain.
        try install.sessions.save(try ServerSession(server: other, email: sam, token: ExpoInstall.otherToken))

        install.migration().run()
        #expect(try install.sessions.load(server: other) == nil)
        let auth = AuthFixtures.controller(
            transport: ledgerServer.transport, sessions: install.sessions, preferences: install.auth)
        await auth.restore()
        #expect(auth.state.account?.email == alex)
        #expect(auth.state.account?.isVerified == true)
    }

    // MARK: Damaged and unavailable data

    @Test("whenAnExpoLedgerIsCorrupt_ExpoMigration_ShouldKeepItAndImportTheOthers")
    func corruptLedger() async throws {
        let ledgerServer = FakeLedgerServer()
        let token = ledgerServer.addAccount(alex, ledger: synced)
        try stageTypicalInstall(token: token)
        try install.asyncStorage.set([install.ledgerKey(sam): #"{"base":{"version":4,"#])

        let report = install.migration().run()
        #expect(report.status == .needsAttention)
        #expect(report.accounts.first { $0.email == sam }?.outcome == .unreadable)
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending)

        // Even after alex syncs, the damaged record and the Expo data around it stay.
        let store = OfflineLedgerStore(
            files: install.ledgers, today: TestCalendar("2026-11-05").today, now: { Date(timeIntervalSince1970: 1_800_000_000) },
            retry: .immediate())
        #expect(await store.engine(for: Offline.scope()).sync(using: try Offline.client(ledgerServer)) == .synced)
        let after = install.migration().run()
        #expect(after.status == .needsAttention)
        #expect(try install.storedValues()[install.ledgerKey(sam)] != nil)
        #expect(try install.storedValues()[install.ledgerKey(alex)] == nil, "the synced one is retired")
        #expect(install.keychain.value(ExpoLegacyFormat.lockKey) == "true")
        #expect(install.migration().journal().finishedAt == nil)
    }

    @Test("whenAnUnscopedLedgerHasNoServerChoice_ExpoMigration_ShouldKeepItForSupport")
    func unknownServer() throws {
        try install.stageLedger(alex, base: synced, local: withPending)
        let report = install.migration().run()
        #expect(report.status == .needsAttention)
        #expect(report.accounts.map(\.outcome) == [.unknownServer])
        #expect(try install.storedValues().count == 1)
    }

    @Test("whenTheManifestIsDamaged_ExpoMigration_ShouldStillApplyTheLockAndKeepTheStore")
    func corruptStore() throws {
        try install.secureStore.set("true", forKey: ExpoLegacyFormat.lockKey)
        try FileManager.default.createDirectory(at: install.storeDirectory, withIntermediateDirectories: true)
        try Data("[".utf8).write(to: install.storeDirectory.appendingPathComponent("manifest.json"))
        let report = install.migration().run()
        #expect(report.status == .needsAttention)
        #expect(report.notes.contains(.storeCorrupt))
        #expect(try install.lock.read())
        #expect(install.keychain.value(ExpoLegacyFormat.lockKey) == "true", "nothing is cleaned up")
    }

    @Test("whenTheLedgerWriteFails_ExpoMigration_ShouldKeepTheSourceAndRetryAtTheNextLaunch")
    func writeFails() throws {
        try stageTypicalInstall()
        let faulty = FaultyFileSystem()
        faulty.failWrites.withLock { $0 = true }
        install.ledgerFileSystem = faulty

        let report = install.migration().run()
        #expect(report.status == .retryLater)
        #expect(report.accounts.map(\.outcome) == [.blocked(.writeFailed)])
        #expect(try install.ledgers.load(Offline.scope()) == nil)

        faulty.failWrites.withLock { $0 = false }
        #expect(install.migration().run().accounts.map(\.outcome) == [.imported(pendingChanges: 1)])
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending)
    }

    // MARK: Lock

    @Test("whenTheExpoLockWasOn_FirstNativeLaunch_ShouldStartLocked")
    @MainActor
    func startsLocked() async throws {
        try stageTypicalInstall()
        let migration = install.migration()
        migration.run()
        let lock = AppLockController(
            store: ExpoImportingLockStore(native: install.lock, migration: migration),
            authenticator: FakeDeviceAuthenticator([.cancelled]))
        await lock.start()
        #expect(lock.isEnabled)
        #expect(lock.status == .locked)
        #expect(lock.conceals)
    }

    @Test("whenTheKeychainIsLockedAtLaunch_ExpoMigration_ShouldKeepTheAppConcealedUntilItCanReadTheSetting")
    @MainActor
    func keychainLocked() async throws {
        try stageTypicalInstall()
        install.keychain.forcedStatus.withLock { $0 = errSecInteractionNotAllowed }
        let migration = install.migration()
        let report = migration.run()
        #expect(report.status == .retryLater)
        #expect(report.notes.contains(.lockUndetermined))
        #expect(try install.sessions.load(server: server) == nil, "the token could not be read yet")
        #expect(try install.ledgers.load(Offline.scope())?.local == withPending, "files were readable")

        let lock = AppLockController(
            store: ExpoImportingLockStore(native: install.lock, migration: migration),
            authenticator: FakeDeviceAuthenticator([.cancelled]))
        await lock.start()
        #expect(lock.status == .unreadable)
        #expect(lock.conceals)

        install.keychain.forcedStatus.withLock { $0 = nil }
        await lock.start()
        #expect(lock.status == .locked)
        let next = migration.run()
        #expect(try install.sessions.load(server: server)?.email == alex, "imported at the next launch")
        #expect(next.status == .waitingForSync)
    }

    @Test("whenTheExpoLockValueIsDamaged_ExpoMigration_ShouldTurnTheLockOn")
    func damagedLock() throws {
        try install.secureStore.set("yes", forKey: ExpoLegacyFormat.lockKey)
        let report = install.migration().run()
        #expect(report.notes.contains(.lockImported))
        #expect(try install.lock.read())
    }

    @Test("whenTheExpoLockWasOff_ExpoMigration_ShouldLeaveItOffAndNeverUndoALaterNativeChoice")
    func lockOff() throws {
        try install.stageServer()
        try install.secureStore.set("false", forKey: ExpoLegacyFormat.lockKey)
        install.migration().run()
        #expect(try install.lock.read() == false)
        try install.lock.write(true)
        install.migration().run()
        #expect(try install.lock.read())
    }

    @Test("whenTheNativeLockCannotBeSaved_ExpoImportingLockStore_ShouldFailClosed")
    func lockSaveFails() throws {
        try install.secureStore.set("true", forKey: ExpoLegacyFormat.lockKey)
        install.lock.setFailures(reads: nil, writes: .failed(-1))
        let migration = install.migration()
        #expect(migration.run().notes.contains(.lockUndetermined))
        let store = ExpoImportingLockStore(native: install.lock, migration: migration)
        #expect(throws: AppLockStoreError.failed(-1)) { try store.read() }
        install.lock.setFailures(reads: nil, writes: nil)
        #expect(try store.read())
    }

    @Test("whenOnlyKeychainItemsWereLeftByADeletedInstall_ExpoMigration_ShouldKeepTheLockButNotTheSession")
    func leftoverKeychain() throws {
        try install.secureStore.set("true", forKey: ExpoLegacyFormat.lockKey)
        try install.secureStore.set(APIFixtures.token, forKey: ExpoLegacyFormat.sessionKey)
        let report = install.migration().run()
        #expect(try install.lock.read())
        #expect(try install.sessions.load(server: server) == nil)
        #expect(install.keychain.count == 0, "the leftovers are removed")
        #expect(report.status == .finished)
    }

    // MARK: Sync and retirement

    @Test("whenTheImportedAccountSyncs_ExpoMigration_ShouldRemoveTheExpoDataOnlyAfterward")
    func retiresAfterSync() async throws {
        let ledgerServer = FakeLedgerServer()
        let token = ledgerServer.addAccount(alex, ledger: synced, revision: 4)
        try stageTypicalInstall(token: token)
        try install.asyncStorage.set(["EXPO_NOTIFICATIONS_SOMETHING": "kept"])
        install.migration().run()

        let store = OfflineLedgerStore(
            files: install.ledgers, today: TestCalendar("2026-11-05").today,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }, retry: .immediate())
        let engine = await store.engine(for: Offline.scope())
        ledgerServer.outage.withLock { $0 = .offline }
        #expect(await engine.sync(using: try Offline.client(ledgerServer)) == .failed(.offline))
        #expect(install.migration().run().status == .waitingForSync)
        #expect(try install.storedValues()[install.ledgerKey(alex)] != nil, "kept while offline")

        ledgerServer.outage.withLock { $0 = nil }
        #expect(await engine.sync(using: try Offline.client(ledgerServer)) == .synced)
        #expect(ledgerServer.ledger(alex)?.transactions.map(\.id).sorted() == ["lunch", "taxi"])

        let report = install.migration().run()
        #expect(report.status == .finished)
        #expect(report.accounts.map(\.outcome) == [.retired])
        #expect(try install.storedValues() == ["EXPO_NOTIFICATIONS_SOMETHING": "kept"], "other libraries' keys stay")
        #expect(install.keychain.count == 0)
        #expect(install.migration().run().status == .finished)
    }

    @Test("whenTheImportedSessionExpired_ImportedEntries_ShouldWaitForTheSameAccountToSignInAgain")
    func reauthentication() async throws {
        let ledgerServer = FakeLedgerServer()
        let token = ledgerServer.addAccount(alex, ledger: synced)
        try stageTypicalInstall(token: token)
        install.migration().run()
        ledgerServer.revoke(alex)

        let store = OfflineLedgerStore(
            files: install.ledgers, today: TestCalendar("2026-11-05").today,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }, retry: .immediate())
        let engine = await store.engine(for: Offline.scope())
        #expect(await engine.sync(using: try Offline.client(ledgerServer)) == .sessionExpired)
        #expect(try install.ledgers.load(Offline.scope())?.pending.entryIDs == ["taxi"])
        #expect(install.migration().run().status == .waitingForSync)

        // Signing in again (a new token for the same account) syncs the imported entries.
        _ = try await APIClient(configuration: APIConfiguration(server: server), transport: ledgerServer.transport)
            .login(WireCredentials(email: alex, password: "fixture-password"))
        #expect(await engine.sync(using: try Offline.client(ledgerServer)) == .synced)
        #expect(install.migration().run().status == .finished)
    }
}
