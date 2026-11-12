import PennyAccessibility
import XCTest

/// Activity search (MAZ-73 with MAZ-121's server search; MAZ-82 "PostgreSQL search
/// acceptance"): online keyword and typo search on the real .NET/PostgreSQL search endpoint,
/// the local fallback while a change is waiting to sync, the empty state, and reconciliation
/// once the device reconnects.
final class SearchJourneyTests: PennyUITestCase {
    /// Two synthetic entries another device recorded: one the queries find, one they must not.
    @MainActor
    private func seed(_ stack: Stack, _ account: TestAccount) async throws -> (match: String, other: String) {
        let match = "search-bakery-\(stack.configuration.runID)-\(Device.name)"
        let other = "search-hardware-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token,
            [
                Stack.Transaction(id: match, title: "Corner bakery croissants", cents: 875, categoryID: "food"),
                Stack.Transaction(id: other, title: "Hardware store hinges", cents: 1999, categoryID: "home"),
            ])
        return (match, other)
    }

    @MainActor
    private func signedInActivity(_ account: TestAccount, waitingFor id: String) async throws -> Penny {
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.openActivity()
        try penny.waitForEntry(id)
        return penny
    }

    /// Online: a keyword and a typo both reach the server's search and list only the match; the
    /// scope line says the results came from the server. A query with no match shows the empty
    /// state with Search all months.
    @MainActor
    func test_whenOnline_Search_ShouldUseTheServerForKeywordsAndTypos() async throws {
        let stack = try await stack()
        let account = try await makeAccount("search-online")
        let ids = try await seed(stack, account)
        let penny = try await signedInActivity(account, waitingFor: ids.other)

        try penny.search("bakery")
        try penny.wait(for: AccessibilityID.Journeys.searchScopeServer, timeout: 30)
        try penny.wait(for: AccessibilityID.Row.entry(ids.match))
        XCTAssertFalse(penny.element(AccessibilityID.Row.entry(ids.other)).exists, "the other entry matched")
        screenshot("search-online-keyword")

        // No match: the empty state replaces the list (and clears the rows, so the typo's result
        // below cannot be a leftover of the keyword search).
        try penny.search("zzqxv nothing here")
        try penny.wait(for: AccessibilityID.Activity.searchEmpty, timeout: 30)
        XCTAssertFalse(penny.element(AccessibilityID.Row.entry(ids.match)).exists)
        screenshot("search-empty")

        // A typo the device's substring search cannot match: only the server's trigram tier (word
        // similarity at least 0.6) finds it. "bakry" for "bakery" scores below that, so it would not.
        try penny.search("croisants")
        try penny.wait(for: AccessibilityID.Row.entry(ids.match), timeout: 30)
        let scope = try penny.wait(for: AccessibilityID.Journeys.searchScopeServer).label
        XCTAssertTrue(scope.hasPrefix("1 result"), scope)
        screenshot("search-online-typo")
    }

    /// With a change waiting to sync, search runs on this device (which includes the pending
    /// entry) and says so; once the server accepts the change, the same query is answered by the
    /// server again and still finds the entry.
    @MainActor
    func test_whenAChangeIsPending_Search_ShouldSearchTheDeviceThenReconcileWithTheServer() async throws {
        let stack = try await stack()
        let account = try await makeAccount("search-pending")
        let ids = try await seed(stack, account)
        let penny = try await signedInActivity(account, waitingFor: ids.other)

        try await stack.setFaults([FaultRule(method: "PUT", pathPrefix: "/api/ledger", abort: true)])
        let title = "Pottery class \(Device.name)"
        try penny.addEntry(amount: "30.00", title: title)
        try penny.openActivity()
        try penny.search("pottery")
        try penny.wait(for: AccessibilityID.Journeys.searchScopeDevice, timeout: 30)
        let scope = penny.element(AccessibilityID.Journeys.searchScopeDevice).label
        XCTAssertTrue(scope.contains("haven't synced"), scope)
        let pending = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH 'entry.' AND label CONTAINS %@", title))
        XCTAssertTrue(pending.firstMatch.waitForExistence(timeout: Penny.timeout), "the pending entry is not listed")
        XCTAssertFalse(penny.element(AccessibilityID.Row.entry(ids.match)).exists)
        screenshot("search-pending-device")

        // Reconnect: the change syncs, and the server answers the same query.
        try await stack.clearFaults()
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 45) {
            LedgerJSON.transaction($0, title: title) != nil
        }
        let id = try XCTUnwrap(LedgerJSON.transaction(ledger, title: title)?["id"] as? String)
        try penny.search("potery")
        try penny.wait(for: AccessibilityID.Journeys.searchScopeServer, timeout: 45)
        try penny.wait(for: AccessibilityID.Row.entry(id))
        screenshot("search-reconciled-server")
    }
}
