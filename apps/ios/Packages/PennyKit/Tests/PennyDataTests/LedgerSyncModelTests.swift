import Foundation
import PennyData
import PennyDomain
import Testing

/// The app's wiring: a real `AuthController` and `OfflineLedgerStore` against the fake server.
@MainActor
final class SyncHarness {
    let server: FakeLedgerServer
    let directory: URL
    let calendar: TestCalendar
    let triggers: TestTriggers
    let sessions: EphemeralSessionStore
    let preferences: EphemeralAuthPreferences
    let store: OfflineLedgerStore
    let auth: AuthController
    let model: LedgerSyncModel

    init(
        server: FakeLedgerServer = FakeLedgerServer(), directory: URL = Offline.directory(),
        calendar: TestCalendar = TestCalendar("2026-11-05"), online: Bool = true,
        sessions: EphemeralSessionStore = EphemeralSessionStore(),
        preferences: EphemeralAuthPreferences = EphemeralAuthPreferences(
            server: SavedServer(server: APIFixtures.server))
    ) {
        self.server = server
        self.directory = directory
        self.calendar = calendar
        self.sessions = sessions
        self.preferences = preferences
        triggers = TestTriggers(online: online)
        store = Offline.store(directory, calendar: calendar)
        auth = AuthFixtures.controller(
            transport: server.transport, sessions: sessions, preferences: preferences, localData: store)
        model = LedgerSyncModel(
            auth: auth, store: store, network: triggers, calendar: triggers,
            backoff: SyncBackoff(initial: .milliseconds(10), maximum: .milliseconds(20)))
        model.start()
    }

    /// The same device after the process was killed: same files, Keychain and preferences.
    func relaunched(online: Bool) -> SyncHarness {
        SyncHarness(
            server: server, directory: directory, calendar: calendar, online: online, sessions: sessions,
            preferences: preferences)
    }

    func signIn(_ email: String = Offline.alex) async throws {
        if auth.state == .restoring { await auth.restore() }
        try await auth.signIn(email: email, password: "correct horse battery")
    }

    func waitFor(_ phase: LedgerSyncState.Phase, _ comment: Comment = "phase") async {
        await eventually(comment) { self.model.state.phase == phase }
    }

    func goOffline() async {
        server.outage.withLock { $0 = .offline }
        triggers.setOnline(false)
        await eventually("offline") { !self.model.isOnline }
    }

    func goOnline() {
        server.outage.withLock { $0 = nil }
        triggers.setOnline(true)
    }
}

@Suite("Offline ledger sync model")
@MainActor
struct LedgerSyncModelTests {
    let harness = SyncHarness()

    init() {
        harness.server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch", title: "Lunch")]))
    }

    func signedIn() async throws {
        try await harness.signIn()
        await harness.waitFor(.upToDate, "first download")
    }

    @Test("whenTheAccountSignsIn_LedgerSyncModel_ShouldDownloadAndShowTheLedger")
    func signInDownloads() async throws {
        #expect(harness.model.state == .signedOut)
        try await signedIn()
        #expect(harness.model.ledger?.entry(id: "lunch")?.title == "Lunch")
        #expect(harness.model.state.scope == Offline.scope())
        #expect(harness.model.state.lastSyncedAt != nil)
        #expect(harness.model.canUseOnlineOnlyActions)
    }

    @Test("whenSavedOfflineThenKilledAndRelaunched_LedgerSyncModel_ShouldKeepTheChangeAndSyncOnReconnect")
    func offlineSaveRelaunchReconnect() async throws {
        try await signedIn()
        await harness.goOffline()
        let receipt = try await harness.model.save(.saveEntry(Offline.entry("taxi", title: "Taxi to airport")))
        #expect(receipt.savedOffline)
        #expect(receipt.pendingCount == 1)
        #expect(harness.model.state.phase == .offline)
        #expect(harness.model.state.pending.entryIDs == ["taxi"])
        #expect(!harness.model.canUseOnlineOnlyActions, "shared actions and receipt uploads need the network")

        // The process is killed; the app starts again, still offline.
        let relaunched = harness.relaunched(online: false)
        await relaunched.auth.restore()
        #expect(relaunched.auth.state.account?.email == Offline.alex)
        await eventually("pending work restored") { relaunched.model.ledger?.entry(id: "taxi") != nil }
        #expect(relaunched.model.state.phase == .offline)
        #expect(relaunched.model.localSearch("airport").map(\.id) == ["taxi"])

        relaunched.goOnline()
        await relaunched.waitFor(.upToDate, "synced after reconnect")
        #expect(harness.server.ledger(Offline.alex)?.entry(id: "taxi")?.title == "Taxi to airport")
        #expect(relaunched.model.state.pending.isEmpty)
    }

    @Test("whenTheServerEndsTheSession_LedgerSyncModel_ShouldSignOutKeepChangesAndSyncThemAfterSignIn")
    func sessionExpiry() async throws {
        try await signedIn()
        harness.server.revoke(Offline.alex)
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        await eventually("session ended") { harness.auth.state == .signedOut(.sessionExpired(email: Offline.alex)) }
        await eventually("ledger hidden") { harness.model.ledger == nil }
        #expect(harness.model.state.phase == .sessionExpired)
        #expect(harness.model.state.scope == Offline.scope())
        #expect(harness.model.state.pending.entryIDs == ["taxi"])
        #expect(harness.model.ledger == nil)

        try await harness.signIn()
        await harness.waitFor(.upToDate, "pending work synced after signing in again")
        #expect(harness.server.ledger(Offline.alex)?.entry(id: "taxi") != nil)
    }

    @Test("whenChangesArePending_SignOut_ShouldRefuseInsteadOfDiscardingThem")
    func signOutProtectsPendingWork() async throws {
        try await signedIn()
        await harness.goOffline()
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        await #expect(throws: SignOutFailure.pendingChanges(count: 1)) { try await harness.auth.signOut() }
        #expect(try harness.store.files.load(Offline.scope())?.pending.entryIDs == ["taxi"])
        #expect(harness.model.ledger?.entry(id: "taxi") != nil)
    }

    @Test("whenASaveArrivesWhileSigningOut_SignOut_ShouldRefuseItRatherThanAcknowledgeAndDeleteIt")
    func saveDuringSignOut() async throws {
        try await signedIn()
        let logout = harness.server.hold("POST /api/auth/logout")
        let signOut = Task { try await harness.auth.signOut() }
        await eventually("logout sent") { harness.server.log.all.contains("POST /api/auth/logout") }
        // A save that reaches the engine after the pending count (here, while logout runs).
        let engine = await harness.store.engine(for: Offline.scope())
        await #expect(throws: LedgerSaveError.unavailable) {
            try await engine.commit(.saveEntry(Offline.entry("taxi")))
        }
        logout.open()
        try await signOut.value
        #expect(harness.auth.state == .signedOut(.signedOut))
        #expect(harness.store.storedScopes().isEmpty)
    }

    @Test("whenSignOutAnywayFindsMoreChangesThanAgreed_SignOut_ShouldAskAgainThenRemoveOnlyWithConsent")
    func signOutAnywayWithNewChanges() async throws {
        try await signedIn()
        await harness.goOffline()
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        // The person saw "1 change hasn't synced" and chose "Sign out anyway"; another save
        // landed before it ran.
        try await harness.model.save(.saveEntry(Offline.entry("bus")))
        await #expect(throws: SignOutFailure.pendingChanges(count: 2)) {
            try await harness.auth.signOut(discardingUpTo: 1, removeEvenIfUnreachable: true)
        }
        #expect(try harness.store.files.load(Offline.scope())?.pending.entryIDs == ["taxi", "bus"])
        // Saves resume after the refusal.
        try await harness.model.save(.saveEntry(Offline.entry("tram")))

        try await harness.auth.signOut(discardingUpTo: 3, removeEvenIfUnreachable: true)
        #expect(harness.auth.state == .signedOut(.signedOut))
        #expect(harness.store.storedScopes().isEmpty)
    }

    @Test("whenTheServerIsUnreachableAtSignOut_SignOut_ShouldLetSavesContinue")
    func unreachableSignOutResumesSaves() async throws {
        try await signedIn()
        harness.server.fail("POST /api/auth/logout", with: .offline)
        await #expect(throws: SignOutFailure.serverUnreachable) { try await harness.auth.signOut() }
        let engine = await harness.store.engine(for: Offline.scope())
        try await engine.commit(.saveEntry(Offline.entry("taxi")))
        #expect(try harness.store.files.load(Offline.scope())?.local.entry(id: "taxi") != nil)
    }

    @Test("whenTheCopyIsUnreadable_SignOut_ShouldCountItAsPendingWork")
    func unreadableCopyCountsAsPending() async throws {
        try await signedIn()
        try Data("not json".utf8).write(to: harness.store.files.url(for: Offline.scope()))
        let relaunched = harness.relaunched(online: true)
        await relaunched.auth.restore()
        await relaunched.waitFor(.storageUnreadable)
        await #expect(throws: LedgerSaveError.storageUnreadable) {
            try await relaunched.model.save(.saveEntry(Offline.entry("taxi")))
        }
        await #expect(throws: SignOutFailure.pendingChanges(count: 1)) { try await relaunched.auth.signOut() }
        await relaunched.model.recoverUnreadableStorage()
        await relaunched.waitFor(.upToDate, "recovered from the server")
    }

    @Test("whenALateAnswerArrivesForThePreviousAccount_LedgerSyncModel_ShouldShowOnlyTheNewAccount")
    func staleAnswerAfterAccountSwitch() async throws {
        harness.server.addAccount(Offline.sam, ledger: Offline.ledger([Offline.entry("sams", title: "Sam's coffee")]))
        try await signedIn()
        let alex = try #require(harness.auth.state.account)
        // The sync this save starts is held at the server until alex is gone.
        let gate = harness.server.hold("GET /api/ledger")
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        await eventually("sync in flight") { harness.model.state.phase == .syncing }
        harness.server.revoke(Offline.alex)
        harness.auth.sessionDidExpire(for: alex)

        try await harness.signIn(Offline.sam)
        await eventually("sam's ledger") { harness.model.ledger?.entry(id: "sams") != nil }
        gate.open()
        try await Task.sleep(for: .milliseconds(50))

        #expect(harness.auth.state.account?.email == Offline.sam, "alex's late 401 does not end sam's session")
        #expect(harness.model.state.scope == Offline.scope(Offline.sam))
        #expect(harness.model.ledger?.entry(id: "taxi") == nil)
        #expect(harness.model.ledger?.entry(id: "lunch") == nil)
        #expect(try harness.store.files.load(Offline.scope())?.pending.entryIDs == ["taxi"])
        #expect(harness.server.ledger(Offline.sam)?.entry(id: "taxi") == nil)
    }

    @Test("whenTheServerIsUnavailable_LedgerSyncModel_ShouldShowTheFailureAndRetryWithBackoff")
    func retryAfterServerFailure() async throws {
        try await signedIn()
        harness.server.fail("PUT /api/ledger", with: .status(503))
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        await eventually("retried and synced") {
            harness.model.state.phase == .upToDate && harness.server.ledger(Offline.alex)?.entry(id: "taxi") != nil
        }
        #expect(harness.server.log.all.filter { $0 == "PUT /api/ledger" }.count == 2)
    }

    @Test("whenTheServerRejectsTheWrite_LedgerSyncModel_ShouldShowTheMessageAndWaitForTheNextSave")
    func rejectedWrite() async throws {
        try await signedIn()
        harness.server.fail("PUT /api/ledger", with: .status(400))
        try await harness.model.save(.saveEntry(Offline.entry("taxi")))
        await harness.waitFor(.failed(.rejected(message: "Fault 400")))
        try await Task.sleep(for: .milliseconds(50))
        #expect(harness.server.log.all.filter { $0 == "PUT /api/ledger" }.count == 1, "no automatic retry")
        harness.model.syncNow()
        await harness.waitFor(.upToDate)
    }

    @Test("whenTheDayChanges_LedgerSyncModel_ShouldRecordDueOccurrencesOnceAndSyncThem")
    func dayChange() async throws {
        harness.server.edit(Offline.alex) { $0.recurring = [Offline.rule("rent", next: "2026-11-06")] }
        try await signedIn()
        #expect(harness.model.ledger?.entry(id: "rent:2026-11-06") == nil)
        harness.calendar.set("2026-11-06")
        harness.triggers.dayChanged()
        await eventually("occurrence synced") {
            harness.server.ledger(Offline.alex)?.entry(id: "rent:2026-11-06") != nil
                && harness.model.state.phase == .upToDate
        }
        harness.triggers.dayChanged()
        harness.model.sceneDidBecomeActive()
        try await Task.sleep(for: .milliseconds(50))
        #expect(harness.server.ledger(Offline.alex)?.transactions.filter { $0.recurringId == "rent" }.count == 1)
    }

    @Test("whenTheAppBecomesActive_LedgerSyncModel_ShouldPullOtherDevicesChanges")
    func foregroundPullsChanges() async throws {
        try await signedIn()
        harness.server.edit(Offline.alex) { $0.transactions.append(Offline.entry("web", title: "From the web")) }
        harness.model.sceneDidBecomeActive()
        await eventually("web entry") { harness.model.ledger?.entry(id: "web") != nil }
    }

    // MARK: Search

    @Test("whenChangesArePendingOrTheLedgerChanged_LedgerSyncModel_ShouldNotShowServerPages")
    func searchReconciliation() async throws {
        try await signedIn()
        let page = try Self.page(scope: Offline.scope(), keys: ["personal:lunch"])
        #expect(harness.model.reconcile(page, startedAt: harness.model.searchEpoch) == .show(page))
        #expect(
            harness.model.reconcile(
                try Self.page(scope: Offline.scope(Offline.sam), keys: []), startedAt: harness.model.searchEpoch)
                == .searchAgain)

        let started = harness.model.searchEpoch
        let lunch = try #require(harness.model.ledger?.entry(id: "lunch"))
        await harness.goOffline()
        try await harness.model.save(.deleteEntry(lunch))
        #expect(harness.model.reconcile(page, startedAt: started) == .searchAgain, "a delete since the search began")
        #expect(harness.model.reconcile(page, startedAt: harness.model.searchEpoch) == .useLocalResults)
        #expect(harness.model.localSearch("lunch").isEmpty, "the pending delete hides the row")
        #expect(harness.model.searchesLocally(serverHasSearch: true))

        harness.goOnline()
        await harness.waitFor(.upToDate)
        let fresh = try Self.page(scope: Offline.scope(), keys: [])
        #expect(harness.model.reconcile(fresh, startedAt: harness.model.searchEpoch) == .show(fresh))
    }

    @Test("whenPagesRepeatAResult_SearchResults_ShouldListItOnce")
    func searchResultsDeduplicate() throws {
        let first = try Self.page(scope: Offline.scope(), keys: ["shared:dinner", "personal:lunch"], cursor: "c1")
        var results = SearchResults(first: first)
        #expect(results.hasMore)
        #expect(results.append(try Self.page(scope: Offline.scope(), keys: ["shared:dinner", "personal:taxi"])))
        #expect(results.items.map(\.key) == ["shared:dinner", "personal:lunch", "personal:taxi"])
        #expect(!results.hasMore)
        #expect(!results.append(try Self.page(scope: Offline.scope(Offline.sam), keys: ["personal:x"])))
    }

    static func page(scope: AccountScope, keys: [String], cursor: String? = nil) throws -> SearchPage {
        let items = keys.map { key in
            let id = String(key.split(separator: ":")[1])
            if key.hasPrefix("shared:") {
                return
                    ##"{"key":"\##(key)","source":"shared","match":"title","entry":{"id":"\##(id)","householdId":"h1","title":"Dinner","date":"2026-11-02","totalCents":4000,"shareCents":2000,"payerUserId":"u1","category":{"name":"Food","icon":"cafe-outline","color":"#E47850"},"note":""}}"##
            }
            return
                #"{"key":"\#(key)","source":"personal","match":"title","entry":{"id":"\#(id)","title":"Lunch","kind":"expense","total":640,"share":640,"categoryId":"food","date":"2026-11-02","note":""}}"#
        }
        let next = cursor.map { #""\#($0)""# } ?? "null"
        let json =
            #"{"version":1,"items":[\#(items.joined(separator: ","))],"totalCount":\#(keys.count),"nextCursor":\#(next)}"#
        let response = try JSONDecoder().decode(SearchResponse.self, from: Data(json.utf8))
        return SearchPage(scope: scope, request: SearchRequest(query: "lunch"), response: response)
    }
}
