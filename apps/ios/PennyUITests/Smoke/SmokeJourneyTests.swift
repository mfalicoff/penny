import PennyAccessibility
import XCTest

/// The required PR smoke suite (TestPlans/Smoke.xctestplan): the shortest journeys that prove
/// a build installs, talks to the real API and keeps data across launches, on iPhone and iPad.
final class SmokeJourneyTests: PennyUITestCase {
    /// A clean install opens at sign-in for the configured server.
    @MainActor
    func test_whenFreshlyInstalled_Launch_ShouldOpenSignInForTheTestServer() async throws {
        let penny = try await launch()

        try penny.wait(for: AccessibilityID.Auth.email)
        try penny.wait(for: AccessibilityID.Auth.server)
        XCTAssertFalse(penny.element(AccessibilityID.Screen.home).exists)
        screenshot("clean-install-sign-in")
    }

    /// Sign in → create → relaunch → read, against the real .NET API on PostgreSQL:
    /// the app's write reaches the server, a second device's write reaches the app, and both
    /// survive terminating the app.
    @MainActor
    func test_whenSignedInChangedAndRelaunched_Journey_ShouldKeepSessionAndReadServerData() async throws {
        let stack = try await stack()
        let account = try await makeAccount("smoke")
        let penny = try await launch()

        // Sign in with the password form.
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)
        screenshot("signed-in-empty-home")

        // Create: change the ledger currency (an empty ledger's only write before MAZ-73).
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        try penny.tap(AccessibilityID.Settings.currency("EUR"))
        try penny.waitForSelection(AccessibilityID.Settings.currency("EUR"))
        try await stack.waitForLedger(token: account.token) { $0["currency"] as? String == "EUR" }
        screenshot("currency-saved")

        // Another device adds an entry through the API.
        let entryID = "smoke-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransaction(token: account.token, id: entryID, title: "Smoke groceries", cents: 1234)

        // Relaunch: the session comes back from the Keychain without signing in again.
        let relaunched = try await relaunch()
        try relaunched.waitForShell()
        XCTAssertFalse(relaunched.isShowingSignIn, "Relaunch asked to sign in again")

        // Read: the other device's entry and this device's currency.
        try relaunched.openActivity()
        try relaunched.waitForEntry(entryID)
        screenshot("activity-after-relaunch")
        try relaunched.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        XCTAssertTrue(try relaunched.isSelected(AccessibilityID.Settings.currency("EUR")))
    }

    /// Home → Add expense → Saved → Activity (MAZ-81 "Additional verification").
    @MainActor
    func test_whenExpenseAddedFromHome_Journey_ShouldShowSavedAndListItInActivity() async throws {
        // TODO(MAZ-73): the entry form, keypad and save flow replace the placeholder Add entry
        // sheet. Once they land: sign in a fresh account, tap `tab.add` (iPhone) or
        // `sidebar.add` (iPad), enter an amount and title, save, wait for `toast.saved`, open
        // Activity, find `entry.<id>` and confirm the server ledger has it
        // (`Stack.waitForLedger`). Keep it in the Smoke plan.
        throw XCTSkip("Needs the MAZ-73 entry form; the v2 Add entry sheet is a placeholder.")
    }
}
