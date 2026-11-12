import Foundation
import PennyAccessibility
import XCTest

/// Opening household notifications on the real API (MAZ-79, Full plan). The payload is injected
/// in process (`PENNY_TEST_NOTIFICATION*`, the same `PushNotifications.didOpen` path the app
/// delegate uses), at a cold launch or on a return from the background; APNs transport is
/// verified on a physical device instead (docs/ios-notifications.md#verification).
final class NotificationJourneyTests: PennyUITestCase {
    /// The month before the pinned server month (2026-10), so the household must open on the
    /// notification's month rather than the current one.
    private static let month = "2026-09"

    private static func payload(household: String, expense: String? = nil, month: String = month) -> String {
        var object: [String: Any] = [
            "aps": ["alert": ["title": "New household expense", "body": "A member added an expense."]],
            "householdId": household, "month": month, "eventId": "evt-ui",
        ]
        if let expense { object["expenseId"] = expense }
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// A household with one September expense, owned by a fresh account.
    @MainActor
    private func household() async throws -> (TestAccount, String, String) {
        let stack = try await stack()
        let alex = try await makeAccount("notify-alex")
        let household = try await stack.createHousehold(token: alex.token, name: "Notified \(Device.name)")
        let expense = try await stack.createExpense(
            token: alex.token, household: household, payer: alex.userID, title: "Groceries", cents: 4200,
            date: "2026-09-20")
        return (alex, household, expense)
    }

    /// Signs in without waiting for Home: the notification's destination opens instead.
    @MainActor
    private func signIn(_ penny: Penny, _ account: TestAccount) throws {
        try penny.type(account.email, into: AccessibilityID.Auth.email)
        try penny.type(account.password, into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.signIn)
    }

    @MainActor
    private func back(_ penny: Penny) {
        let button = penny.app.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
        if button.waitForExistence(timeout: 5) { button.tap() }
    }

    /// Cold start signed out: the expense opens only after sign-in, with Back to the household on
    /// September and then the Shared list. A cold start signed in (relaunch) opens it again.
    @MainActor
    func test_whenANotificationLaunchesTheAppSignedOut_Notification_ShouldOpenTheExpenseAfterSignIn() async throws {
        let (alex, household, expense) = try await household()
        var options = LaunchOptions()
        options.notification = Self.payload(household: household, expense: expense)
        let penny = try await launch(options)
        try penny.wait(for: AccessibilityID.Auth.signIn, timeout: 30)
        XCTAssertFalse(penny.element(AccessibilityID.Screen.householdExpense).exists, "nothing opens before sign-in")

        try signIn(penny, alex)
        try penny.wait(for: AccessibilityID.Screen.householdExpense, timeout: 30)
        try penny.wait(for: AccessibilityID.Households.share(alex.userID), timeout: 20)
        screenshot("notification-expense")

        back(penny)
        try penny.wait(for: AccessibilityID.Screen.household)
        let month = try penny.wait(for: AccessibilityID.Households.month, timeout: 20)
        XCTAssertTrue(month.label.contains("September"), "the household opened on the notification's month")
        try penny.wait(for: AccessibilityID.Households.expense(expense), timeout: 20)
        back(penny)
        try penny.wait(for: AccessibilityID.Screen.shared)

        // Cold start while signed in: the session restores, then the expense opens.
        let again = try await relaunch()
        try again.wait(for: AccessibilityID.Screen.householdExpense, timeout: 30)
    }

    /// Warm start: Penny is running and signed in, goes to the background, and a notification
    /// is opened. The household opens on its month.
    @MainActor
    func test_whenANotificationOpensTheRunningApp_Notification_ShouldOpenTheHouseholdMonth() async throws {
        let (alex, household, _) = try await household()
        var options = LaunchOptions()
        options.notificationOnResume = Self.payload(household: household)
        let penny = try await launch(options)
        try penny.signIn(email: alex.email, password: alex.password)

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(penny.app.wait(for: .runningBackground, timeout: 10))
        penny.app.activate()
        try penny.wait(for: AccessibilityID.Screen.household, timeout: 30)
        let month = try penny.wait(for: AccessibilityID.Households.month, timeout: 20)
        XCTAssertTrue(month.label.contains("September"))
        screenshot("notification-household-warm")
    }

    /// A household the account can't see opens a named state, never another account's data; a
    /// malformed payload opens nothing (Home).
    @MainActor
    func test_whenTheTargetIsInaccessibleOrMalformed_Notification_ShouldShowNoPrivateContent() async throws {
        let (_, household, expense) = try await household()
        let bea = try await makeAccount("notify-bea")

        var options = LaunchOptions()
        options.notification = Self.payload(household: household, expense: expense)
        let penny = try await launch(options)
        try signIn(penny, bea)
        try penny.wait(for: AccessibilityID.Screen.householdExpense, timeout: 30)
        try penny.wait(for: AccessibilityID.Feedback.state("error"), timeout: 20)
        XCTAssertFalse(penny.app.staticTexts["Groceries"].exists, "Alex's expense is never shown to Bea")
        screenshot("notification-inaccessible")

        var malformed = LaunchOptions()
        malformed.notification = #"{"householdId":"../\#(household)","month":"2026-09"}"#
        let again = try await launch(malformed)
        try signIn(again, bea)
        try again.waitForShell()
        XCTAssertFalse(again.element(AccessibilityID.Screen.household).exists)
    }
}
