import PennyAccessibility
import XCTest

/// Recurring suggestions end to end (MAZ-290), against the real API: entries that repeat show in
/// Recurring's Suggested section, Dismiss hides one at once with Undo on the toast and stores the
/// dismissal in the ledger, and Make it a schedule saves one normal schedule whose first date
/// follows the latest entry. The seed is the cards' sample (`iphone-recurring-suggested`):
/// Netflix after a price step, weekly Tutoring income and a few schedules.
final class RecurringSuggestionTests: PennyUITestCase {
    static let today = "2026-11-12"
    static let netflix = "expense|netflix|monthly"
    static let tutoring = "income|tutoring|weekly"

    /// Signs a new account in with the cards' sample ledger written by "another device".
    @MainActor
    private func seeded(
        _ label: String, appearance: String = "light", withEntries: Bool = true, capture: Bool = false
    ) async throws -> (Penny, TestAccount) {
        let stack = try await stack()
        let account = try await makeAccount(label)
        try await stack.updateLedger(token: account.token) { ledger in
            ledger["accounts"] = [["id": "visa", "name": "Visa", "type": "credit"]]
            ledger["transactions"] = withEntries ? Self.entries : []
            ledger["recurring"] = withEntries ? Self.schedules : []
        }
        XCUIDevice.shared.appearance = appearance == "dark" ? .dark : .light
        var options = capture ? LaunchOptions.capture : LaunchOptions()
        options.today = Self.today
        options.seed = ContainerSeed(standardDefaults: ["penny.appearance": appearance])
        if Device.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        let penny = try await launch(options)
        try penny.signIn(email: account.email, password: account.password)
        penny.dismissSavePassword(timeout: 3)
        try penny.waitForShell()
        try penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
        return (penny, account)
    }

    override func tearDown() async throws {
        await MainActor.run {
            XCUIDevice.shared.appearance = .light
            XCUIDevice.shared.orientation = .portrait
        }
        try await super.tearDown()
    }

    /// The cards' states in each appearance, for the side-by-side review with
    /// docs/design/penny-ios/previews (captures named `recurring-suggested`, `recurring-empty`,
    /// `schedule-suggested`, `suggestion-dismissed-toast`).
    @MainActor
    private func captureSuggested(_ appearance: String) async throws {
        let (penny, _) = try await seeded("suggest-capture-\(appearance)", appearance: appearance, capture: true)
        try penny.wait(for: AccessibilityID.Organize.suggestion(Self.netflix))
        if Device.isPad {
            try penny.tap(AccessibilityID.Organize.suggestion(Self.netflix))
            try penny.wait(for: AccessibilityID.Screen.suggestion)
            screenshot("recurring-suggested")
            return
        }
        screenshot("recurring-suggested")
        try penny.tap(AccessibilityID.Organize.suggestionAccept(Self.netflix))
        try penny.wait(for: AccessibilityID.Organize.scheduleFormMatched)
        screenshot("schedule-suggested")
        try penny.tap("scheduleForm.cancel")
        try penny.waitForAbsence(of: AccessibilityID.Screen.scheduleForm)
        try penny.tap(AccessibilityID.Organize.suggestionDismiss(Self.netflix))
        try penny.wait(for: AccessibilityID.Feedback.savedToast)
        screenshot("suggestion-dismissed-toast")
    }

    @MainActor
    func test_whenEntriesRepeatInLight_RecurringSuggestions_ShouldBeCaptured() async throws {
        try await captureSuggested("light")
    }

    @MainActor
    func test_whenEntriesRepeatInDark_RecurringSuggestions_ShouldBeCaptured() async throws {
        try await captureSuggested("dark")
    }

    /// No schedules and nothing to suggest (`iphone-recurring-empty`), in both appearances.
    @MainActor
    func test_whenNothingRepeats_EmptyRecurring_ShouldBeCaptured() async throws {
        guard !Device.isPad else { throw XCTSkip("iphone-recurring-empty is an iPhone card") }
        for appearance in ["light", "dark"] {
            let (penny, _) = try await seeded(
                "suggest-empty-\(appearance)", appearance: appearance, withEntries: false, capture: true)
            try penny.wait(for: AccessibilityID.Organize.empty)
            screenshot("recurring-empty")
            app.terminate()
        }
    }

    /// Dismiss hides the suggestion at once and stores `{id}|{share}` in the ledger; Undo on the
    /// toast brings it back and takes the dismissal back on the server too.
    @MainActor
    func test_whenASuggestionIsDismissedAndUndone_Ledger_ShouldStoreThenDropTheDismissal() async throws {
        let stack = try await stack()
        let (penny, account) = try await seeded("suggest-dismiss")
        try penny.wait(for: AccessibilityID.Organize.suggestion(Self.tutoring))
        if Device.isPad {
            // On the iPad a suggestion's actions are in the pane beside the list.
            try penny.tap(AccessibilityID.Organize.suggestion(Self.tutoring))
            try penny.wait(for: AccessibilityID.Screen.suggestion)
        }
        try penny.tap(AccessibilityID.Organize.suggestionDismiss(Self.tutoring))
        try penny.waitForAbsence(of: AccessibilityID.Organize.suggestion(Self.tutoring))
        // Undo at once: the toast lasts four seconds (its button is found by label; the toast's own
        // identifier isn't always queryable in time on the iPad).
        let undo = penny.app.buttons["Undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3), "the toast offers Undo")
        undo.tap()
        try penny.wait(for: AccessibilityID.Organize.suggestion(Self.tutoring))
        _ = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            (ledger["dismissedSuggestions"] as? [String] ?? []).isEmpty
        }
        // Dismissed again, it stays dismissed on the server.
        if Device.isPad { try penny.tap(AccessibilityID.Organize.suggestion(Self.tutoring)) }
        try penny.tap(AccessibilityID.Organize.suggestionDismiss(Self.tutoring))
        try penny.waitForAbsence(of: AccessibilityID.Organize.suggestion(Self.tutoring))
        _ = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            (ledger["dismissedSuggestions"] as? [String]) == ["\(Self.tutoring)|6000"]
        }
    }

    /// Make it a schedule opens the filled-in form with the matched entries; saving adds one
    /// schedule dated after the latest entry, and the suggestion leaves the list.
    @MainActor
    func test_whenASuggestionIsMadeASchedule_Server_ShouldHoldOneRuleFromTheNextDate() async throws {
        let stack = try await stack()
        let (penny, account) = try await seeded("suggest-accept")
        if Device.isPad {
            try penny.tap(AccessibilityID.Organize.suggestion(Self.netflix))
            try penny.wait(for: AccessibilityID.Screen.suggestion)
        }
        try penny.tap(AccessibilityID.Organize.suggestionAccept(Self.netflix))
        try penny.wait(for: AccessibilityID.Screen.scheduleForm)
        XCTAssertEqual(try penny.value(of: "scheduleForm.title"), "Netflix")
        // Already in your activity sits under Schedule: below the fold on the iPad's form sheet.
        let matched = penny.element(AccessibilityID.Organize.scheduleFormMatched)
        for _ in 0..<4 where !matched.waitForExistence(timeout: 2) {
            penny.element(AccessibilityID.Screen.scheduleForm).swipeUp()
        }
        XCTAssertTrue(matched.exists, "the matched entries are listed")
        try penny.tap(AccessibilityID.Organize.scheduleSave)
        try penny.waitForAbsence(of: AccessibilityID.Screen.scheduleForm)
        try penny.waitForAbsence(of: AccessibilityID.Organize.suggestion(Self.netflix))
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.recurring(ledger).contains { $0["title"] as? String == "Netflix" }
        }
        let rules = LedgerJSON.recurring(ledger).filter { $0["title"] as? String == "Netflix" }
        XCTAssertEqual(rules.count, 1)
        XCTAssertEqual(rules.first?["date"] as? String, "2026-12-03")
        XCTAssertEqual(rules.first?["nextDate"] as? String, "2026-12-03")
        XCTAssertEqual(rules.first?["share"] as? Int, 1699)
        XCTAssertEqual(rules.first?["accountId"] as? String, "visa")
        // No entry was recorded for it: the first date is after today.
        XCTAssertFalse(
            LedgerJSON.transactions(ledger).contains { $0["recurringId"] as? String == rules.first?["id"] as? String })
        XCTAssertEqual(LedgerJSON.transactions(ledger).count, Self.entries.count)
    }

    // MARK: The cards' sample

    static var entries: [[String: Any]] {
        let netflix = [("2026-08-03", 1549), ("2026-09-03", 1549), ("2026-10-03", 1699), ("2026-11-03", 1699)]
        let tutoring = ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11"]
        return netflix.enumerated().map { index, item in
            [
                "id": "netflix-\(index + 1)", "title": "Netflix", "kind": "expense", "total": item.1,
                "share": item.1, "categoryId": "fun", "accountId": "visa", "date": item.0, "note": "",
            ]
        }
            + tutoring.enumerated().map { index, date in
                [
                    "id": "tutoring-\(index + 1)", "title": "Tutoring", "kind": "income", "total": 6000, "share": 6000,
                    "categoryId": "salary", "date": date, "note": "",
                ]
            }
    }

    static var schedules: [[String: Any]] {
        func rule(
            _ id: String, _ title: String, _ kind: String, _ cents: Int, _ category: String, next: String,
            account: String? = nil, active: Bool = true
        ) -> [String: Any] {
            var rule: [String: Any] = [
                "id": id, "title": title, "kind": kind, "total": cents, "share": cents, "categoryId": category,
                "date": "2026-06-\(next.suffix(2))", "note": "", "frequency": "monthly", "nextDate": next,
                "anchorDay": Int(next.suffix(2)) ?? 1, "active": active,
            ]
            if let account { rule["accountId"] = account }
            return rule
        }
        return [
            rule("payday", "Payday", "income", 225_000, "salary", next: "2026-11-15"),
            rule("internet", "Internet", "expense", 6500, "home", next: "2026-11-18", account: "visa"),
            rule("transit", "Transit pass", "expense", 6200, "transport", next: "2026-12-06"),
            rule("gym", "Gym", "expense", 4500, "groceries", next: "2026-12-01", active: false),
            rule("tfsa", "TFSA contribution", "investment", 20000, "investments", next: "2026-12-06"),
        ]
    }
}
