import PennyAccessibility
import XCTest

/// Install, upgrade and relaunch behavior (Full plan).
final class LifecycleTests: PennyUITestCase {
    /// State an earlier install left is picked up by this build: the container-seed hook that
    /// MAZ-72's Expo-to-native migration rehearsal plugs its legacy layout into.
    @MainActor
    func test_whenAnEarlierInstallLeftState_Launch_ShouldKeepIt() async throws {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.seed = .nativeDarkAppearance
        let penny = try await launch(options)

        try penny.openSettingsPage("appearance", screen: AccessibilityID.Screen.appearance)
        XCTAssertTrue(try penny.isSelected(AccessibilityID.Settings.appearance("dark")))
        XCTAssertFalse(try penny.isSelected(AccessibilityID.Settings.appearance("system")))
        screenshot("seeded-dark-appearance")
    }

    /// `PENNY_UPGRADE_FROM_APP` makes `ios.sh ui-test` install and run a previous build first, so
    /// this launch is an in-place upgrade of a real install rather than a fresh one.
    @MainActor
    func test_whenInstalledOverAPreviousBuild_Launch_ShouldOpenWithoutErrors() async throws {
        guard ProcessInfo.processInfo.environment["PENNY_UITEST_UPGRADE"] == "1" else {
            throw XCTSkip("Set PENNY_UPGRADE_FROM_APP to a previous Penny.app to rehearse an upgrade.")
        }
        var options = LaunchOptions()
        options.resetsState = false
        let penny = try await launch(options)

        XCTAssertFalse(penny.element(AccessibilityID.Root.configurationError).exists)
        XCTAssertTrue(
            penny.element(AccessibilityID.Auth.email).waitForExistence(timeout: Penny.timeout)
                || penny.element(AccessibilityID.Screen.home).exists)
        screenshot("after-upgrade")
    }

    /// Terminating Penny keeps what it saved locally, and a fresh install (the reset) does not.
    @MainActor
    func test_whenTerminatedOrReinstalled_StoredState_ShouldSurviveOnlyTheRelaunch() async throws {
        let account = try await makeAccount("lifecycle")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        let relaunched = try await relaunch()
        try relaunched.waitForShell()

        // The reset is what a clean install looks like: no saved session.
        let reinstalled = try await launch()
        try reinstalled.wait(for: AccessibilityID.Auth.email)
        XCTAssertFalse(reinstalled.element(AccessibilityID.Screen.home).exists)
    }
}
