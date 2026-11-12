import PennyAccessibility
import XCTest

/// Transactions end to end (MAZ-82, parity row "transactions"): add expense and income, edit,
/// filter, delete with confirmation, and relaunch, against the real API. After every write the
/// server ledger is read back and its recorded totals compared with what Activity shows.
final class EntryJourneyTests: PennyUITestCase {
    @MainActor
    func test_whenEntriesAreAddedEditedAndDeleted_Activity_ShouldKeepTheServerTotalsInStep() async throws {
        let stack = try await stack()
        let account = try await makeAccount("entries")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)

        // Add an expense and an income through the form.
        let expenseTitle = "Corner market \(Device.name)"
        let incomeTitle = "Side project \(Device.name)"
        try penny.addEntry(amount: "20.00", title: expenseTitle)
        try penny.addEntry(kind: "Income", amount: "100.00", title: incomeTitle)
        var ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.transaction(ledger, title: expenseTitle) != nil
                && LedgerJSON.transaction(ledger, title: incomeTitle) != nil
        }
        let expense = try XCTUnwrap(LedgerJSON.transaction(ledger, title: expenseTitle))
        let income = try XCTUnwrap(LedgerJSON.transaction(ledger, title: incomeTitle))
        let expenseID = try XCTUnwrap(expense["id"] as? String)
        let incomeID = try XCTUnwrap(income["id"] as? String)
        XCTAssertEqual(expense["total"] as? Int, 2000)
        XCTAssertEqual(income["kind"] as? String, "income")
        XCTAssertEqual(income["share"] as? Int, 10000)
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 2000)
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "income"), 10000)

        // Activity lists both, and its recorded totals match the server's.
        try penny.openActivity()
        try penny.waitForEntry(expenseID)
        try penny.waitForEntry(incomeID)
        var totals = try penny.activityTotals()
        XCTAssertTrue(totals.contains("20.00") && totals.contains("100.00"), totals)
        screenshot("activity-expense-and-income")

        // Filtering by kind narrows the list but never the totals.
        try penny.tap(AccessibilityID.Activity.kindFilter("income"))
        try penny.waitForAbsence(of: AccessibilityID.Row.entry(expenseID))
        try penny.wait(for: AccessibilityID.Row.entry(incomeID))
        XCTAssertEqual(try penny.activityTotals(), totals, "filters change the list, not the recorded totals")
        try penny.tap(AccessibilityID.Activity.kindFilter("all"))
        try penny.wait(for: AccessibilityID.Row.entry(expenseID))

        // Edit the expense's amount from its detail.
        try penny.openEntry(expenseID)
        try penny.editOpenEntry()
        try penny.replaceAmount("25.50")
        try penny.saveEntryForm()
        ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.transaction(ledger, id: expenseID)?["total"] as? Int == 2550
        }
        XCTAssertEqual(LedgerJSON.transaction(ledger, id: expenseID)?["share"] as? Int, 2550)
        XCTAssertEqual(LedgerJSON.transaction(ledger, id: expenseID)?["title"] as? String, expenseTitle)
        screenshot("entry-edited")

        // Delete the income: it always asks first; Cancel keeps it, Delete removes it.
        try penny.openActivity()
        try penny.openEntry(incomeID)
        try penny.tap(AccessibilityID.Journeys.detailDelete)
        try penny.cancelDialog(AccessibilityID.Journeys.deleteCancel, confirmID: AccessibilityID.Activity.deleteConfirm)
        try penny.wait(for: AccessibilityID.Journeys.detailEdit)
        try penny.deleteOpenEntry()
        ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.transaction(ledger, id: incomeID) == nil
        }
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "income"), 0)
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 2550)

        // Durable across a relaunch: the same rows and totals come back from storage and server.
        let relaunched = try await relaunch()
        try relaunched.waitForShell()
        try relaunched.openActivity()
        try relaunched.waitForEntry(expenseID)
        XCTAssertFalse(relaunched.element(AccessibilityID.Row.entry(incomeID)).exists)
        totals = try relaunched.activityTotals()
        XCTAssertTrue(totals.contains("25.50"), totals)
        XCTAssertFalse(totals.contains("100.00"), totals)
        screenshot("activity-after-relaunch")
    }

    /// A save the server refuses (HTTP 500) stays on the device and is sent once the server
    /// recovers: no duplicate, no lost amount.
    @MainActor
    func test_whenTheServerFailsWithAnError_Save_ShouldKeepTheEntryAndSyncItOnce() async throws {
        let stack = try await stack()
        let account = try await makeAccount("server-error")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)

        try await stack.setFaults([FaultRule(method: "PUT", pathPrefix: "/api/ledger", status: 500)])
        let title = "Hardware store \(Device.name)"
        try penny.addEntry(amount: "42.00", title: title)
        try penny.wait(for: AccessibilityID.Feedback.syncBanner, timeout: 30)
        screenshot("server-error-pending")
        let before = try await stack.ledger(token: account.token).ledger
        XCTAssertNil(LedgerJSON.transaction(before, title: title), "the write got through the fault")

        try await stack.clearFaults()
        penny.pullToRefresh()
        let after = try await stack.waitForLedger(token: account.token, timeout: 45) { ledger in
            LedgerJSON.transaction(ledger, title: title) != nil
        }
        XCTAssertEqual(LedgerJSON.transactions(after).filter { $0["title"] as? String == title }.count, 1)
        XCTAssertEqual(LedgerJSON.shareTotal(after, kind: "expense"), 4200)
        try penny.waitForAbsence(of: AccessibilityID.Feedback.syncBanner, timeout: 30)
    }
}
