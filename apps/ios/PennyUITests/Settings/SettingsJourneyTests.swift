import PennyAccessibility
import XCTest

/// Settings persistence and the app lock's failure path (MAZ-82, parity row "settings"): the
/// appearance choice survives a relaunch and restyles the app, and turning the lock on where the
/// device cannot authenticate (a simulator without Face ID enrolled or a passcode) explains why
/// and leaves the lock off. The lock's success path needs enrolled biometrics and is a device
/// check (docs/ios-qa.md#device-release-checklist).
final class SettingsJourneyTests: PennyUITestCase {
    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
        try await super.tearDown()
    }

    @MainActor
    private func launchDemo() async throws -> Penny {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    /// Light, Dark and System are each kept across a relaunch, with the system in light mode so
    /// a stored Dark is visibly not the device's own setting.
    @MainActor
    func test_whenAnAppearanceIsChosen_Relaunch_ShouldKeepIt() async throws {
        XCUIDevice.shared.appearance = .light
        var penny = try await launchDemo()
        for choice in ["dark", "light", "system"] {
            try penny.openSettingsPage("appearance", screen: AccessibilityID.Screen.appearance)
            try penny.tap(AccessibilityID.Settings.appearance(choice))
            try penny.waitForSelection(AccessibilityID.Settings.appearance(choice))
            if choice == "dark" { screenshot("appearance-dark-chosen") }
            penny = try await relaunch()
            try penny.waitForShell()
            try penny.openSettingsPage("appearance", screen: AccessibilityID.Screen.appearance)
            XCTAssertTrue(try penny.isSelected(AccessibilityID.Settings.appearance(choice)), "\(choice) was not kept")
            try penny.closeSettings()
        }
    }

    @MainActor
    func test_whenTheDeviceCannotAuthenticate_AppLock_ShouldExplainAndStayOff() async throws {
        let penny = try await launchDemo()
        try penny.openSettingsPage("appLock", screen: AccessibilityID.Screen.appLock)
        let toggle = try penny.wait(for: AccessibilityID.Settings.appLockToggle)
        XCTAssertEqual(toggle.value as? String, "0")
        // The switch itself, not the row's label.
        let control = toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle
        control.tap()
        let message = try penny.wait(for: AccessibilityID.Settings.appLockMessage)
        XCTAssertFalse(message.label.isEmpty)
        XCTAssertEqual(
            penny.element(AccessibilityID.Settings.appLockToggle).value as? String, "0", "the lock turned on")
        screenshot("app-lock-unavailable")

        // Nothing is locked after a relaunch.
        let relaunched = try await relaunch()
        try relaunched.waitForShell()
        XCTAssertFalse(relaunched.element(AccessibilityID.Screen.lock).exists)
    }
}
