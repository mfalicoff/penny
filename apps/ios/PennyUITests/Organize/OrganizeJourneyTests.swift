import PennyAccessibility
import XCTest

/// Accounts, categories and recurrence end to end (MAZ-74 features, MAZ-82 parity rows
/// "accounts/categories" and "recurrence"), against the real API: what the forms save is read
/// back from the server, a rename reaches the entries that use the category, and a schedule
/// records its occurrences as the app's day moves forward across relaunches.
final class OrganizeJourneyTests: PennyUITestCase {
    @MainActor
    private func signIn(_ label: String) async throws -> (Penny, TestAccount) {
        let account = try await makeAccount(label)
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)
        return (penny, account)
    }

    /// Create a category, use it, rename it: the server keeps one category id whose name
    /// changed, the entry keeps pointing at it, and Activity shows the new name, also after a
    /// relaunch.
    @MainActor
    func test_whenACategoryIsCreatedAndRenamed_Entries_ShouldShowTheNewName() async throws {
        let stack = try await stack()
        let (penny, account) = try await signIn("categories")

        try penny.openSettingsPage("categories", screen: AccessibilityID.Screen.categories)
        try penny.tap(AccessibilityID.Organize.addCategory)
        try penny.wait(for: AccessibilityID.Screen.categoryForm)
        try penny.type("Pottery supplies", into: AccessibilityID.Organize.categoryName)
        try penny.tap(AccessibilityID.Organize.categorySave)
        try penny.waitForAbsence(of: AccessibilityID.Screen.categoryForm)
        var ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.categories(ledger).contains { $0["name"] as? String == "Pottery supplies" }
        }
        let category = try XCTUnwrap(
            LedgerJSON.categories(ledger).first { $0["name"] as? String == "Pottery supplies" })
        let categoryID = try XCTUnwrap(category["id"] as? String)
        XCTAssertEqual(category["kind"] as? String, "expense")
        screenshot("category-created")

        // Another device records an entry in it.
        let entryID = "category-entry-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token,
            [Stack.Transaction(id: entryID, title: "Glaze set", cents: 3400, categoryID: categoryID)])

        // Rename it here.
        try penny.tap(AccessibilityID.Organize.category(categoryID))
        try penny.wait(for: AccessibilityID.Screen.categoryForm)
        try penny.replaceText("Ceramics", in: AccessibilityID.Organize.categoryName)
        try penny.tap(AccessibilityID.Organize.categorySave)
        try penny.waitForAbsence(of: AccessibilityID.Screen.categoryForm)
        ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.categories(ledger).contains {
                $0["id"] as? String == categoryID && $0["name"] as? String == "Ceramics"
            }
        }
        XCTAssertEqual(LedgerJSON.categories(ledger).filter { $0["id"] as? String == categoryID }.count, 1)
        XCTAssertEqual(LedgerJSON.transaction(ledger, id: entryID)?["categoryId"] as? String, categoryID)
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 3400)

        try penny.closeSettings()
        try penny.openActivity()
        let row = try penny.waitForEntry(entryID)
        XCTAssertTrue(row.label.contains("Ceramics"), row.label)
        screenshot("activity-renamed-category")

        let relaunched = try await relaunch()
        try relaunched.openActivity()
        let again = try relaunched.waitForEntry(entryID)
        XCTAssertTrue(again.label.contains("Ceramics"), again.label)
    }

    /// A new label-only account reaches the server with its name and default type.
    @MainActor
    func test_whenAnAccountIsCreated_Accounts_ShouldSaveItOnTheServer() async throws {
        let stack = try await stack()
        let (penny, account) = try await signIn("accounts")

        try penny.openSettingsPage("accounts", screen: AccessibilityID.Screen.accounts)
        try penny.tap(AccessibilityID.Organize.addAccount)
        try penny.wait(for: AccessibilityID.Screen.accountForm)
        try penny.type("Travel card", into: AccessibilityID.Organize.accountName)
        try penny.tap(AccessibilityID.Organize.accountSave)
        try penny.waitForAbsence(of: AccessibilityID.Screen.accountForm)
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.accounts(ledger).contains { $0["name"] as? String == "Travel card" }
        }
        let saved = try XCTUnwrap(LedgerJSON.accounts(ledger).first { $0["name"] as? String == "Travel card" })
        let accountID = try XCTUnwrap(saved["id"] as? String)
        try penny.wait(for: AccessibilityID.Organize.account(accountID))
        screenshot("account-created")
    }

    /// A monthly schedule records its first date at once, then the next occurrence when the
    /// app opens on a later day: the server ends with both entries and twice the amount.
    @MainActor
    func test_whenAScheduleIsAdded_Recurrence_ShouldRecordEachOccurrenceAcrossRelaunches() async throws {
        let stack = try await stack()
        let (penny, account) = try await signIn("recurring")

        try penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
        try penny.tap(AccessibilityID.Organize.addSchedule)
        try penny.wait(for: AccessibilityID.Screen.scheduleForm)
        try penny.type("Studio rent", into: AccessibilityID.Journeys.scheduleTitle)
        try penny.type("120.00", into: AccessibilityID.Journeys.scheduleAmount)
        try penny.tap(AccessibilityID.Organize.scheduleSave)
        try penny.waitForAbsence(of: AccessibilityID.Screen.scheduleForm)

        var ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.recurring(ledger).contains { $0["title"] as? String == "Studio rent" }
        }
        let rule = try XCTUnwrap(LedgerJSON.recurring(ledger).first { $0["title"] as? String == "Studio rent" })
        let ruleID = try XCTUnwrap(rule["id"] as? String)
        XCTAssertEqual(rule["total"] as? Int, 12000)
        XCTAssertEqual(rule["frequency"] as? String, "monthly")
        try penny.wait(for: AccessibilityID.Organize.schedule(ruleID))
        screenshot("schedule-created")
        ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            Self.occurrences(ledger, ruleID).count == 1
        }
        XCTAssertEqual(Self.occurrences(ledger, ruleID).first?["date"] as? String, Stack.defaultToday)

        // A month later the app opens again: the November occurrence is recorded and synced.
        app.terminate()
        var options = LaunchOptions()
        options.resetsState = false
        options.today = "2026-11-16"
        let later = try await launch(options)
        try later.waitForShell()
        ledger = try await stack.waitForLedger(token: account.token, timeout: 45) { ledger in
            Self.occurrences(ledger, ruleID).count == 2
        }
        let dates = Set(Self.occurrences(ledger, ruleID).compactMap { $0["date"] as? String })
        XCTAssertEqual(dates, [Stack.defaultToday, "2026-11-15"])
        XCTAssertEqual(LedgerJSON.shareTotal(ledger, kind: "expense"), 24000)
    }

    private static func occurrences(_ ledger: [String: Any], _ ruleID: String) -> [[String: Any]] {
        LedgerJSON.transactions(ledger).filter { $0["recurringId"] as? String == ruleID }
    }
}
