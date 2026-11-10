import PennyAccessibility
import XCTest

/// Controlled network failures, injected on the real API with `PUT /api/test/faults`
/// (the app's own networking is untouched). Full plan.
final class NetworkFailureTests: PennyUITestCase {
    /// Offline writes stay on the device, are marked as waiting, and reach the server once it
    /// answers again, including across a relaunch.
    @MainActor
    func test_whenServerUnreachable_LedgerWrite_ShouldWaitAndSyncAfterRecovery() async throws {
        let stack = try await stack()
        let account = try await makeAccount("offline")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        try penny.wait(for: AccessibilityID.Home.empty)
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        // The ledger is loaded; from here the server drops every ledger request.
        try await stack.setFaults([.offline("/api/ledger")])
        try penny.tap(AccessibilityID.Settings.currency("USD"))
        try penny.waitForSelection(AccessibilityID.Settings.currency("USD"))
        try penny.closeSettings()
        try penny.openHome()
        try penny.wait(for: AccessibilityID.Feedback.syncBanner, timeout: 30)
        screenshot("offline-pending")
        let unsynced = try await stack.ledger(token: account.token).ledger
        XCTAssertEqual(unsynced["currency"] as? String, "CAD", "The write reached the server through the fault")

        // Terminate while offline: the pending write is durable.
        try await stack.clearFaults()
        let relaunched = try await relaunch()
        try relaunched.waitForShell()
        _ = try await stack.waitForLedger(token: account.token, timeout: 45) { $0["currency"] as? String == "USD" }
        try relaunched.waitForAbsence(of: AccessibilityID.Feedback.syncBanner, timeout: 30)
    }

    /// A failed sign-in (the server drops the connection) keeps what the person typed.
    @MainActor
    func test_whenSignInRequestFails_SignIn_ShouldKeepTheInputAndExplain() async throws {
        let stack = try await stack()
        let account = try await makeAccount("signin-offline")
        let penny = try await launch()

        try await stack.setFaults([.offline("/api/auth/login")])
        try penny.type(account.email, into: AccessibilityID.Auth.email)
        try penny.type(account.password, into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.signIn)
        try penny.wait(for: AccessibilityID.Auth.error, timeout: 30)
        XCTAssertEqual(try penny.value(of: AccessibilityID.Auth.email), account.email)
        screenshot("sign-in-unreachable")

        try await stack.clearFaults()
        try penny.tap(AccessibilityID.Auth.signIn)
        try penny.waitForShell()
    }
}
