import Foundation
import Testing

@testable import PennyData

/// A clock the test moves by hand.
@MainActor
final class ManualClock {
    private(set) var now = ContinuousClock.now
    func advance(_ duration: Duration) { now = now.advanced(by: duration) }
}

/// Lock after (MAZ-133): the delay counts from when Penny goes to the background.
@MainActor
@Suite("App lock delay")
struct AppLockDelayTests {
    let clock = ManualClock()

    func makeLock(
        _ delay: AppLockDelay, auth: FakeDeviceAuthenticator, preferences: EphemeralDevicePreferences? = nil
    ) -> AppLockController {
        let clock = clock
        return AppLockController(
            store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth,
            preferences: preferences ?? EphemeralDevicePreferences(lockDelay: delay), now: { clock.now })
    }

    /// Unlocked at launch, then sent to the background.
    func openThenBackground(_ lock: AppLockController) async {
        await lock.start()
        #expect(lock.status == .unlocked)
        await lock.activityChanged(.inactive)
        await lock.activityChanged(.background)
    }

    @Test(
        "whenReturningBeforeTheDelayEnds_AppLock_ShouldStayOpenWithoutAPrompt",
        arguments: [(AppLockDelay.oneMinute, Duration.seconds(59)), (.fiveMinutes, .seconds(299))])
    func returnsInTime(delay: AppLockDelay, away: Duration) async {
        let auth = FakeDeviceAuthenticator([.success])
        let lock = makeLock(delay, auth: auth)
        await openThenBackground(lock)
        #expect(lock.status == .unlocked)
        #expect(lock.conceals, "the app-switcher snapshot is concealed whatever the delay")
        clock.advance(away)
        await lock.activityChanged(.inactive)
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked)
        #expect(!lock.conceals)
        #expect(auth.prompts == [.unlock], "only the launch prompt")
    }

    @Test(
        "whenReturningOnceTheDelayHasEnded_AppLock_ShouldLockAndPrompt",
        arguments: [(AppLockDelay.oneMinute, Duration.seconds(60)), (.fiveMinutes, .seconds(300))])
    func returnsLate(delay: AppLockDelay, away: Duration) async {
        let auth = FakeDeviceAuthenticator([.success, .cancelled])
        let lock = makeLock(delay, auth: auth)
        await openThenBackground(lock)
        clock.advance(away)
        // Locked as soon as the app is on its way back, before it is active.
        lock.setActivity(.inactive)
        #expect(lock.status == .locked)
        await lock.activityChanged(.active)
        #expect(auth.prompts == [.unlock, .unlock])
        #expect(lock.status == .locked, "a cancelled prompt keeps it locked")
        #expect(lock.conceals)
    }

    @Test("whenTheDelayIsImmediately_AppLock_ShouldLockOnTheWayToTheBackground")
    func immediately() async {
        let lock = makeLock(.immediately, auth: FakeDeviceAuthenticator([.success]))
        await openThenBackground(lock)
        #expect(lock.status == .locked)
    }

    @Test("whenTheSettingIsMissing_AppLock_ShouldLockImmediately")
    func defaultsToImmediately() async {
        #expect(EphemeralDevicePreferences().lockDelay == .immediately)
        let lock = AppLockController(
            store: EphemeralAppLockSettingStore(enabled: true), authenticator: FakeDeviceAuthenticator([.success]))
        #expect(lock.delay == .immediately)
        await openThenBackground(lock)
        #expect(lock.status == .locked)
    }

    @Test("whenColdLaunched_AppLock_ShouldAskWhateverTheDelay", arguments: AppLockDelay.allCases)
    func coldLaunch(delay: AppLockDelay) async {
        let auth = FakeDeviceAuthenticator([.cancelled])
        let lock = makeLock(delay, auth: auth)
        await lock.start()
        #expect(lock.status == .locked)
        #expect(auth.prompts == [.unlock])
    }

    @Test("whenTheLaunchPromptSucceedsAfterBackgrounding_AppLock_ShouldStayLockedAndPromptOnReturn")
    func staleLaunchSuccess() async {
        let auth = FakeDeviceAuthenticator([.success, .cancelled])
        auth.holdPrompts = true
        let lock = makeLock(.fiveMinutes, auth: auth)
        let launch = Task { await lock.start() }
        await eventually("the launch prompt is open") { auth.isHolding }
        // Backgrounded mid-prompt, back within the delay: still locked, the old answer is dropped.
        lock.setActivity(.background)
        clock.advance(.seconds(5))
        auth.finish(.success)
        await launch.value
        #expect(lock.status == .locked)
        let back = Task { await lock.activityChanged(.active) }
        await eventually("the return prompts again") { auth.heldCount == 1 && auth.prompts.count == 2 }
        auth.finish(.cancelled)
        await back.value
        #expect(lock.status == .locked, "a return within the delay does not reopen a locked app")
    }

    @Test("whenBackgroundedWhileTurningOnWithADelay_AppLock_ShouldComeBackLocked")
    func backgroundWhileEnablingWithADelay() async {
        let clock = clock
        let store = EphemeralAppLockSettingStore()
        let auth = FakeDeviceAuthenticator([.success, .cancelled])
        auth.holdPrompts = true
        let lock = AppLockController(
            store: store, authenticator: auth, preferences: EphemeralDevicePreferences(lockDelay: .fiveMinutes),
            now: { clock.now })
        await lock.start()
        #expect(lock.status == .unlocked)
        let change = Task { await lock.setEnabled(true) }
        await eventually("the enable prompt is open") { auth.isHolding }
        // The lock was off when the app left, so no delay started: it must not open by itself.
        lock.setActivity(.background)
        auth.finish(.success)
        await change.value
        #expect(store.stored)
        #expect(lock.isEnabled)
        #expect(lock.status == .locked)
        #expect(lock.conceals)
        clock.advance(.seconds(5))
        lock.setActivity(.inactive)
        #expect(lock.status == .locked, "a return within the delay does not open a lock turned on mid-trip")
        let back = Task { await lock.activityChanged(.active) }
        await eventually("the return prompts to unlock") { auth.heldCount == 1 && auth.prompts == [.enable, .unlock] }
        auth.finish(.cancelled)
        await back.value
        #expect(lock.status == .locked)
        #expect(lock.conceals)
    }

    @Test("whenTimeIsSpentInactiveAfterReturning_AppLock_ShouldCountOnlyTheBackground")
    func inactiveDoesNotCount() async {
        let lock = makeLock(.oneMinute, auth: FakeDeviceAuthenticator([.success]))
        await openThenBackground(lock)
        clock.advance(.seconds(30))
        await lock.activityChanged(.active)
        // Control Center or a system alert: inactive, never backgrounded.
        await lock.activityChanged(.inactive)
        clock.advance(.seconds(120))
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked)
    }

    @Test("whenEachTripIsShort_AppLock_ShouldStartTheDelayAgainEachTime")
    func eachTripCountsFromItsOwnStart() async {
        let lock = makeLock(.oneMinute, auth: FakeDeviceAuthenticator([.success]))
        await openThenBackground(lock)
        clock.advance(.seconds(40))
        await lock.activityChanged(.active)
        await lock.activityChanged(.background)
        clock.advance(.seconds(40))
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked, "80 seconds away in total, but never 60 in one go")
    }

    @Test("whenChanged_AppLockDelay_ShouldBeSavedForTheNextLaunchAndApplyNextTime")
    func savesTheChoice() async {
        let preferences = EphemeralDevicePreferences()
        let lock = makeLock(.immediately, auth: FakeDeviceAuthenticator([.success]), preferences: preferences)
        await lock.start()
        lock.setDelay(.fiveMinutes)
        #expect(lock.delay == .fiveMinutes)
        #expect(preferences.lockDelay == .fiveMinutes)
        await lock.activityChanged(.background)
        #expect(lock.status == .unlocked)
        let relaunched = AppLockController(
            store: EphemeralAppLockSettingStore(enabled: true), authenticator: FakeDeviceAuthenticator(),
            preferences: preferences)
        #expect(relaunched.delay == .fiveMinutes)
    }

    @Test("whenTheLockIsOff_AppLockDelay_ShouldNeverConceal")
    func offIgnoresTheDelay() async {
        let clock = clock
        let lock = AppLockController(
            store: EphemeralAppLockSettingStore(), authenticator: FakeDeviceAuthenticator(),
            preferences: EphemeralDevicePreferences(lockDelay: .oneMinute), now: { clock.now })
        await openThenBackground(lock)
        #expect(!lock.conceals)
        clock.advance(.seconds(600))
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked)
    }

    @Test("whenTheLockDelayIsSavedOrUnknown_UserDefaultsDevicePreferences_ShouldKeepItOrFallBackToImmediately")
    func userDefaults() throws {
        let suite = "penny.tests.lockDelay.\(UUID().uuidString)"
        defer { UserDefaults.standard.removePersistentDomain(forName: suite) }
        #expect(UserDefaultsDevicePreferences(suiteName: suite).lockDelay == .immediately)
        UserDefaultsDevicePreferences(suiteName: suite).setLockDelay(.oneMinute)
        #expect(UserDefaultsDevicePreferences(suiteName: suite).lockDelay == .oneMinute)
        try #require(UserDefaults(suiteName: suite)).set("forever", forKey: UserDefaultsDevicePreferences.lockDelayKey)
        #expect(UserDefaultsDevicePreferences(suiteName: suite).lockDelay == .immediately)
    }

    @Test("whenListed_AppLockDelay_ShouldOfferTheCardsChoicesInOrder")
    func choices() {
        #expect(AppLockDelay.allCases.map(\.title) == ["Immediately", "After 1 minute", "After 5 minutes"])
        #expect(AppLockDelay.allCases.map(\.minutes) == [0, 1, 5])
    }
}
