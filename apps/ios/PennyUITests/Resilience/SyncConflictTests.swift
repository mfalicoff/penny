import PennyAccessibility
import XCTest

/// Two devices writing the same personal ledger (MAZ-71's merge, MAZ-82 "conflicting devices"
/// and "reconnect"): this app edits while it cannot reach the server, another device writes
/// through the API meanwhile, and on reconnect the field-by-field merge keeps both sides'
/// changes, as `docs/ios-offline-sync.md#conflict-policy` specifies. Totals are checked on the
/// server after every merge.
final class SyncConflictTests: PennyUITestCase {
    /// Different fields of one entry changed on each device, plus a new entry on the other
    /// device: after reconnecting, the server has this device's title, the other device's
    /// amount and the other entry, and the app shows all of it.
    @MainActor
    func test_whenBothDevicesEditWhileOffline_Reconnect_ShouldMergeBothSides() async throws {
        let stack = try await stack()
        let account = try await makeAccount("conflict")
        let shared = "conflict-shared-\(stack.configuration.runID)-\(Device.name)"
        let other = "conflict-other-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token, [Stack.Transaction(id: shared, title: "Weekly groceries", cents: 5000)])
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.openActivity()
        try penny.waitForEntry(shared)

        // This device goes offline (every ledger request drops) and renames the entry.
        try await stack.setFaults([.offline("/api/ledger")])
        try penny.openEntry(shared)
        try penny.editOpenEntry()
        try penny.replaceText("Weekly groceries and flowers", in: AccessibilityID.EntryForm.title)
        try penny.saveEntryForm()
        screenshot("conflict-offline-edit")
        // The sync banner lives on Home and Activity, not on the pushed detail (iPhone).
        let back = app.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
        if !Device.isPad, back.exists { back.tap() }
        try penny.wait(for: AccessibilityID.Feedback.syncBanner, timeout: 30)

        // Meanwhile the other device changes the amount and adds an entry.
        try await stack.clearFaults()
        try await stack.editTransaction(token: account.token, id: shared, ["total": 6200, "share": 6200])
        try await stack.addTransactions(
            token: account.token,
            [Stack.Transaction(id: other, title: "Bus pass", cents: 9000, categoryID: "transport")])
        try await stack.setFaults([.offline("/api/ledger")])

        // Terminate while still offline: the pending edit is durable.
        let relaunched = try await relaunch()
        try relaunched.waitForShell()
        try relaunched.wait(for: AccessibilityID.Feedback.syncBanner, timeout: 30)

        // Reconnect: both sides survive.
        try await stack.clearFaults()
        relaunched.pullToRefresh()
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 45) { ledger in
            LedgerJSON.transaction(ledger, id: shared)?["title"] as? String == "Weekly groceries and flowers"
        }
        let merged = try XCTUnwrap(LedgerJSON.transaction(ledger, id: shared))
        XCTAssertEqual(merged["total"] as? Int, 6200, "the other device's amount was lost: \(merged)")
        XCTAssertNotNil(LedgerJSON.transaction(ledger, id: other), "the other device's entry was lost")
        XCTAssertEqual(LedgerJSON.transactions(ledger).count, 2)
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 15200)

        try relaunched.waitForAbsence(of: AccessibilityID.Feedback.syncBanner, timeout: 30)
        try relaunched.openActivity()
        try relaunched.waitForEntry(other)
        let row = try relaunched.waitForEntry(shared)
        XCTAssertTrue(row.label.contains("Weekly groceries and flowers"), row.label)
        let totals = try relaunched.activityTotals()
        XCTAssertTrue(totals.contains("152.00"), totals)
        screenshot("conflict-merged")
    }

    /// Deleted here while offline, edited on the other device: the delete wins (the documented
    /// policy), and nothing else is touched.
    @MainActor
    func test_whenDeletedOfflineAndEditedElsewhere_Reconnect_ShouldKeepTheDelete() async throws {
        let stack = try await stack()
        let account = try await makeAccount("conflict-delete")
        let target = "conflict-delete-\(stack.configuration.runID)-\(Device.name)"
        let keep = "conflict-keep-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token,
            [
                Stack.Transaction(id: target, title: "Duplicate taxi", cents: 1800, categoryID: "transport"),
                Stack.Transaction(id: keep, title: "Pharmacy", cents: 1250, categoryID: "health"),
            ])
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.openActivity()
        try penny.waitForEntry(target)

        try await stack.setFaults([.offline("/api/ledger")])
        try penny.openEntry(target)
        try penny.deleteOpenEntry()
        try penny.wait(for: AccessibilityID.Feedback.syncBanner, timeout: 30)

        try await stack.clearFaults()
        try await stack.editTransaction(token: account.token, id: target, ["note": "edited elsewhere"])
        penny.pullToRefresh()
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 45) { ledger in
            LedgerJSON.transaction(ledger, id: target) == nil
        }
        XCTAssertNotNil(LedgerJSON.transaction(ledger, id: keep))
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 1250)
        try penny.openActivity()
        try penny.waitForEntry(keep)
        XCTAssertFalse(penny.element(AccessibilityID.Row.entry(target)).exists)
    }
}
