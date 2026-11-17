import PennyAccessibility
import XCTest

/// Lock after (MAZ-133, `iphone-app-lock`): each choice in Settings › Face ID lock, on the real
/// lock, Keychain setting and scene lifecycle. XCUITest cannot enroll or match Face ID, so the
/// Debug stand-in answers the device check (`PENNY_TEST_DEVICE_AUTH`): turning the lock on
/// succeeds, and each lock's own prompt is cancelled so the lock screen stays up until the test
/// taps Unlock. A Lock after minute lasts `minute` seconds (`PENNY_TEST_LOCK_MINUTE`).
final class AppLockDelayTests: PennyUITestCase {
    /// Seconds in a lock-delay minute: long enough that a quick trip to the Home Screen and back
    /// stays inside "After 1 minute" on a slow CI simulator.
    static let minute = 8

    @MainActor
    private func launchDemoWithLock() async throws -> Penny {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.standInFaceID = true
        options.lockMinute = Self.minute
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    /// Turns the lock on, picks `delay` (an `AppLockDelay` raw value) and closes Settings.
    @MainActor
    private func turnOnLock(_ penny: Penny, delay: String) throws {
        try penny.openSettingsPage("appLock", screen: AccessibilityID.Screen.appLock)
        let toggle = try penny.wait(for: AccessibilityID.Settings.appLockToggle)
        let control = toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle
        control.tap()
        let on = NSPredicate(format: "value == '1'")
        guard
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: on, object: toggle)], timeout: Penny.timeout)
                == .completed
        else { throw UIExpectationFailed(description: "The lock did not turn on") }
        XCTAssertTrue(try penny.isSelected(AccessibilityID.Settings.appLockDelay("immediately")), "the default")
        try penny.tap(AccessibilityID.Settings.appLockDelay(delay))
        try penny.waitForSelection(AccessibilityID.Settings.appLockDelay(delay))
        screenshot("app-lock-delay-\(delay)")
        try penny.closeSettings()
    }

    /// Sends Penny to the Home Screen for at least `seconds`, then brings it back.
    @MainActor
    private func leaveAndReturn(_ penny: Penny, after seconds: Int = 0) async throws {
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(penny.app.wait(for: .runningBackground, timeout: 10))
        if seconds > 0 { try await Task.sleep(for: .seconds(seconds)) }
        penny.app.activate()
        XCTAssertTrue(penny.app.wait(for: .runningForeground, timeout: 10))
    }

    /// The lock screen is up; Unlock opens the app again.
    @MainActor
    private func expectLockedThenUnlock(_ penny: Penny) throws {
        try penny.wait(for: AccessibilityID.Screen.lock)
        // The app's own prompt is cancelled, so the screen waits for the person's tap.
        try penny.tap(AccessibilityID.Lock.unlock)
        try penny.waitForAbsence(of: AccessibilityID.Screen.lock)
    }

    /// Back in the app without a lock screen.
    @MainActor
    private func expectOpen(_ penny: Penny, _ why: String) throws {
        // The cover is drawn while Penny is in the background; it must go away by itself.
        try penny.waitForAbsence(of: AccessibilityID.Screen.lock)
        XCTAssertFalse(penny.element(AccessibilityID.Lock.unlock).exists, why)
    }

    @MainActor
    func test_whenLockAfterIsImmediately_AppLock_ShouldLockOnReturnAndKeepTheDraft() async throws {
        let penny = try await launchDemoWithLock()
        try turnOnLock(penny, delay: "immediately")
        try penny.openAddEntry()
        try penny.enterAmount("12.34")

        try await leaveAndReturn(penny)
        try expectLockedThenUnlock(penny)
        try penny.wait(for: AccessibilityID.Screen.addEntry)
        XCTAssertEqual(try penny.value(of: AccessibilityID.EntryForm.amount), "12.34", "the draft was lost")
    }

    @MainActor
    func test_whenLockAfterIsOneMinute_AppLock_ShouldLockOnlyAfterTheMinute() async throws {
        let penny = try await launchDemoWithLock()
        try turnOnLock(penny, delay: "oneMinute")
        try penny.openAddEntry()
        try penny.enterAmount("5")

        try await leaveAndReturn(penny)
        try expectOpen(penny, "locked before the minute was up")
        try penny.wait(for: AccessibilityID.Screen.addEntry)

        try await leaveAndReturn(penny, after: Self.minute + 1)
        try expectLockedThenUnlock(penny)
        try penny.wait(for: AccessibilityID.Screen.addEntry)
        XCTAssertEqual(try penny.value(of: AccessibilityID.EntryForm.amount), "5", "the draft was lost")
    }

    @MainActor
    func test_whenLockAfterIsFiveMinutes_AppLock_ShouldStayOpenPastOneMinuteAndLockOnColdLaunch() async throws {
        let penny = try await launchDemoWithLock()
        try turnOnLock(penny, delay: "fiveMinutes")

        try await leaveAndReturn(penny, after: Self.minute + 1)
        try expectOpen(penny, "locked after one minute of five")

        // A cold launch always asks, whatever the delay; the choice is kept.
        let relaunched = try await relaunch()
        try expectLockedThenUnlock(relaunched)
        try relaunched.waitForShell()
        try relaunched.openSettingsPage("appLock", screen: AccessibilityID.Screen.appLock)
        XCTAssertTrue(try relaunched.isSelected(AccessibilityID.Settings.appLockDelay("fiveMinutes")))
    }
}
