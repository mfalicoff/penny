import PennyAccessibility
import XCTest

/// Renewal reminders and Renews soon end to end (MAZ-290, phase 2), against the real API: a yearly
/// schedule renewing within 7 days wears the amber Renews soon tag on Recurring and "Renews in 3
/// days" on its page, whose Reminder section turns the reminder on (asking iOS once) and keeps
/// both switches on this device. Monthly schedules never show the tag. On the iPad, the Manage
/// pages carry the copper Add entry capsule after their +.
///
/// The seed is the cards' sample (`iphone-recurring-renews-soon`, `iphone-schedule-reminder`):
/// yearly Amazon Prime renewing on Thursday, Nov 12, seen on Monday, Nov 9.
final class RenewalReminderTests: PennyUITestCase {
    static let today = "2026-11-09"

    @MainActor
    private func seeded(_ label: String, appearance: String = "light", capture: Bool = false) async throws -> Penny {
        let stack = try await stack()
        let account = try await makeAccount(label)
        try await stack.updateLedger(token: account.token) { ledger in
            ledger["accounts"] = [["id": "visa", "name": "Visa", "type": "credit"]]
            ledger["recurring"] = Self.schedules
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
        return penny
    }

    override func tearDown() async throws {
        await MainActor.run {
            XCUIDevice.shared.appearance = .light
            XCUIDevice.shared.orientation = .portrait
        }
        try await super.tearDown()
    }

    /// Recurring with Amazon Prime marked Renews soon (`recurring-renews-soon`), then its page with
    /// the reminder on and the name and amount hidden (`schedule-reminder`).
    @MainActor
    private func capture(_ appearance: String) async throws {
        guard !Device.isPad else { throw XCTSkip("the renewal cards are iPhone cards") }
        let penny = try await seeded("renewal-capture-\(appearance)", appearance: appearance, capture: true)
        try penny.wait(for: AccessibilityID.Organize.schedule("prime"))
        XCTAssertTrue(penny.element(AccessibilityID.Organize.schedule("prime")).label.contains("Renews soon"))
        screenshot("recurring-renews-soon")
        try penny.tap(AccessibilityID.Organize.schedule("prime"), opening: AccessibilityID.Screen.schedule)
        try turnOnReminder(penny)
        screenshot("schedule-reminder")
    }

    @MainActor
    func test_whenAYearlyScheduleRenewsSoonInLight_RenewalCards_ShouldBeCaptured() async throws {
        try await capture("light")
    }

    @MainActor
    func test_whenAYearlyScheduleRenewsSoonInDark_RenewalCards_ShouldBeCaptured() async throws {
        try await capture("dark")
    }

    /// Only the yearly schedule within its window is tagged; its page says how soon and offers the
    /// Reminder section, which a monthly schedule's page doesn't. The reminder is off until turned
    /// on, Show name and amount stays off, and both are kept on the device across a relaunch.
    @MainActor
    func test_whenTheReminderIsTurnedOn_ScheduleReminder_ShouldAskOnceAndStayOn() async throws {
        let penny = try await seeded("renewal-reminder")
        try penny.wait(for: AccessibilityID.Organize.schedule("prime"))
        XCTAssertTrue(penny.element(AccessibilityID.Organize.schedule("prime")).label.contains("Renews soon"))
        XCTAssertFalse(penny.element(AccessibilityID.Organize.schedule("internet")).label.contains("Renews soon"))
        XCTAssertFalse(penny.element(AccessibilityID.Organize.schedule("domain")).label.contains("Renews soon"))

        try penny.tap(AccessibilityID.Organize.schedule("prime"), opening: AccessibilityID.Screen.schedule)
        XCTAssertTrue(
            penny.app.staticTexts["Renews in 3 days"].waitForExistence(timeout: Penny.timeout)
                || penny.element(AccessibilityID.Screen.schedule).label.contains("Renews in 3 days"))
        try turnOnReminder(penny)
        XCTAssertEqual(toggle(penny, AccessibilityID.Organize.scheduleReminderDetails).value as? String, "0")

        app.terminate()
        var options = LaunchOptions()
        options.today = Self.today
        options.resetsState = false
        let again = try await launch(options)
        try again.waitForShell()
        try again.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
        try again.tap(AccessibilityID.Organize.schedule("prime"), opening: AccessibilityID.Screen.schedule)
        let reminder = toggle(again, AccessibilityID.Organize.scheduleReminder)
        XCTAssertTrue(reminder.waitForExistence(timeout: Penny.timeout))
        XCTAssertEqual(reminder.value as? String, "1", "kept on this device")

        // A monthly schedule's page has no Reminder section.
        app.terminate()
        let third = try await launch(options)
        try third.waitForShell()
        try third.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
        try third.tap(AccessibilityID.Organize.schedule("internet"), opening: AccessibilityID.Screen.schedule)
        XCTAssertFalse(
            toggle(third, AccessibilityID.Organize.scheduleReminder).waitForExistence(timeout: 3),
            "monthly schedules have no reminder")
    }

    /// iPad: Recurring, Accounts and Categories carry the copper Add entry capsule after their +,
    /// and it opens Add entry (`ipad-recurring-suggested`).
    @MainActor
    func test_whenOnAnIPadManagePage_AddEntryCapsule_ShouldOpenAddEntry() async throws {
        guard Device.isPad else { throw XCTSkip("the capsule is in the iPad toolbar") }
        let penny = try await seeded("renewal-ipad-add")
        for (route, screen) in [
            ("accounts", AccessibilityID.Screen.accounts), ("categories", AccessibilityID.Screen.categories),
            ("recurring", AccessibilityID.Screen.recurring),
        ] {
            try penny.openSettingsPage(route, screen: screen)
            try penny.wait(for: AccessibilityID.Organize.addEntry)
        }
        try penny.tap(AccessibilityID.Organize.addEntry, opening: AccessibilityID.Screen.addEntry)
    }

    // MARK: Helpers

    private func toggle(_ penny: Penny, _ id: String) -> XCUIElement {
        penny.app.switches.matching(identifier: id).firstMatch
    }

    /// Turns "Remind me before it renews" on, answering the system's notification prompt the
    /// first time.
    @MainActor
    private func turnOnReminder(_ penny: Penny) throws {
        let reminder = toggle(penny, AccessibilityID.Organize.scheduleReminder)
        // The schedule page's list (its screen identifier isn't always queryable once the page is up).
        let list = penny.app.collectionViews.firstMatch
        var scrolled = 0
        while !reminder.isHittable, scrolled < 4 {
            list.swipeUp()
            scrolled += 1
        }
        XCTAssertEqual(reminder.value as? String, "0", "off until turned on")
        // The switch's own control, not the row's label, so the tap lands on it.
        func flip() {
            let control = reminder.switches.firstMatch
            if control.exists {
                control.tap()
            } else {
                reminder.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
            }
        }
        flip()
        // The system's prompt comes the first time, after Penny asks (it may take a few seconds);
        // the switch turns on once it is answered. A tap that landed while the page was still
        // settling is tried once more.
        let deadline = Date().addingTimeInterval(25)
        var retried = false
        while reminder.value as? String != "1", Date() < deadline {
            if penny.acceptSystemAlert("Allow", timeout: 1) { continue }
            if !retried, Date() > deadline.addingTimeInterval(-15), !Penny.springboard.alerts.firstMatch.exists {
                retried = true
                flip()
            }
        }
        XCTAssertEqual(reminder.value as? String, "1", "the reminder turned on")
        // Back to the top, where the card's capture starts.
        for _ in 0..<scrolled { list.swipeDown() }
    }

    // MARK: The cards' sample

    static var schedules: [[String: Any]] {
        func rule(
            _ id: String, _ title: String, _ kind: String, _ cents: Int, _ category: String, next: String,
            frequency: String = "monthly", account: String? = nil, active: Bool = true
        ) -> [String: Any] {
            let start = frequency == "yearly" ? "2025-\(next.dropFirst(5))" : "2026-06-\(next.suffix(2))"
            var rule: [String: Any] = [
                "id": id, "title": title, "kind": kind, "total": cents, "share": cents, "categoryId": category,
                "date": start, "note": "", "frequency": frequency, "nextDate": next,
                "anchorDay": Int(next.suffix(2)) ?? 1, "active": active,
            ]
            if let account { rule["accountId"] = account }
            return rule
        }
        return [
            rule("payday", "Payday", "income", 225_000, "salary", next: "2026-11-15"),
            rule("prime", "Amazon Prime", "expense", 9900, "shopping", next: "2026-11-12", frequency: "yearly"),
            rule("internet", "Internet", "expense", 6500, "home", next: "2026-11-18", account: "visa"),
            rule("transit", "Transit pass", "expense", 6200, "transport", next: "2026-12-06"),
            rule("gym", "Gym", "expense", 4500, "health", next: "2026-12-01", active: false),
            rule("domain", "Domain name", "expense", 2400, "other", next: "2027-03-01", frequency: "yearly"),
            rule("tfsa", "TFSA contribution", "investment", 20000, "investments", next: "2026-12-06"),
        ]
    }
}
