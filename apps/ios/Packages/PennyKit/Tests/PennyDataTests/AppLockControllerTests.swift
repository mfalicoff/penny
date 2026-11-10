import Foundation
import LocalAuthentication
import Security
import Testing

@testable import PennyData

/// A scripted biometric check. Each prompt takes the next result; with `holdPrompts`, a prompt
/// waits until `finish` so a test can background the app mid-prompt.
@MainActor
final class FakeDeviceAuthenticator: DeviceAuthenticator {
    var biometry: BiometryKind = .faceID
    var enableAvailability: AuthenticationResult = .success
    var results: [AuthenticationResult]
    var holdPrompts = false
    private(set) var prompts: [AuthenticationPurpose] = []
    private(set) var cancels = 0
    /// Prompts waiting for `finish`, oldest first (a cancelled prompt can still be waiting
    /// for its answer when the next one opens).
    private var held: [CheckedContinuation<AuthenticationResult, Never>] = []

    init(_ results: [AuthenticationResult] = []) {
        self.results = results
    }

    func canEnable() -> AuthenticationResult { enableAvailability }

    func authenticate(_ purpose: AuthenticationPurpose, reason: String) async -> AuthenticationResult {
        prompts.append(purpose)
        let next = results.isEmpty ? .cancelled : results.removeFirst()
        guard holdPrompts else { return next }
        return await withCheckedContinuation { held.append($0) }
    }

    var isHolding: Bool { !held.isEmpty }
    var heldCount: Int { held.count }

    /// Answers the oldest waiting prompt.
    func finish(_ result: AuthenticationResult) {
        guard !held.isEmpty else { return }
        held.removeFirst().resume(returning: result)
    }

    func cancel() { cancels += 1 }
}

@MainActor
@Suite("App lock")
struct AppLockControllerTests {
    @Test("whenTheSettingCantBeRead_AppLock_ShouldStayConcealedUntilARetrySucceeds")
    func failsClosed() async {
        let store = EphemeralAppLockSettingStore(enabled: false, failReads: .failed(-1))
        let lock = AppLockController(store: store, authenticator: FakeDeviceAuthenticator())
        #expect(lock.conceals, "concealed before the setting is known")
        await lock.start()
        #expect(lock.status == .unreadable)
        #expect(lock.conceals)
        #expect(lock.message?.contains("Try again") == true)
        store.setFailures(reads: nil, writes: nil)
        await lock.start()
        #expect(lock.status == .unlocked)
        #expect(!lock.conceals)
    }

    @Test("whenTheKeychainIsClosedAtLaunch_AppLock_ShouldRetryWhenTheAppBecomesActive")
    func keychainClosed() async {
        let store = EphemeralAppLockSettingStore(enabled: true, failReads: .unavailable)
        let auth = FakeDeviceAuthenticator([.success])
        let lock = AppLockController(store: store, authenticator: auth)
        await lock.start()
        #expect(lock.status == .unreadable)
        store.setFailures(reads: nil, writes: nil)
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked)
        #expect(auth.prompts == [.unlock])
    }

    @Test("whenEnabledAtLaunch_AppLock_ShouldPromptAndOpenOnlyOnSuccess")
    func launchPrompt() async {
        let auth = FakeDeviceAuthenticator([.cancelled, .success])
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        await lock.start()
        #expect(lock.status == .locked)
        #expect(lock.conceals)
        #expect(lock.message == "Unlock was cancelled.")
        await lock.unlock()
        #expect(lock.status == .unlocked)
        #expect(lock.message == nil)
        #expect(auth.prompts == [.unlock, .unlock])
    }

    @Test("whenBackgrounded_AppLock_ShouldLockConcealAndPromptOnReturn")
    func background() async {
        let auth = FakeDeviceAuthenticator([.success, .success])
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        await lock.start()
        #expect(lock.status == .unlocked)
        await lock.activityChanged(.inactive)
        #expect(lock.conceals, "the app switcher snapshot must not show money")
        await lock.activityChanged(.background)
        #expect(lock.status == .locked)
        #expect(auth.cancels == 1)
        await lock.activityChanged(.active)
        #expect(lock.status == .unlocked)
        #expect(auth.prompts.count == 2)
    }

    @Test("whenLaunchedInactive_AppLock_ShouldPromptOnceActiveButNotAgainAfterACancel")
    func launchInactive() async {
        let auth = FakeDeviceAuthenticator([.cancelled])
        let lock = AppLockController(
            store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth, activity: .inactive)
        await lock.start()
        #expect(lock.status == .locked && auth.prompts.isEmpty, "no prompt while not in the foreground")
        await lock.activityChanged(.active)
        #expect(auth.prompts == [.unlock])
        await lock.activityChanged(.inactive)
        await lock.activityChanged(.active)
        #expect(auth.prompts == [.unlock], "after a cancel the person taps Unlock; no prompt loop")
    }

    @Test("whenDisabled_AppLock_ShouldNeverConceal")
    func disabled() async {
        let lock = AppLockController(store: EphemeralAppLockSettingStore(), authenticator: FakeDeviceAuthenticator())
        await lock.start()
        await lock.activityChanged(.inactive)
        #expect(!lock.conceals)
        await lock.activityChanged(.background)
        #expect(!lock.conceals)
        #expect(lock.status == .unlocked)
    }

    @Test("whenASuccessArrivesAfterBackgrounding_AppLock_ShouldNotUnlock")
    func staleSuccess() async {
        let auth = FakeDeviceAuthenticator([.success])
        auth.holdPrompts = true
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        let launch = Task { await lock.start() }
        while !auth.isHolding { await Task.yield() }
        await lock.activityChanged(.background)
        auth.finish(.success)
        await launch.value
        #expect(lock.status == .locked, "a pre-background answer must not open a later session")
        #expect(lock.conceals)
    }

    @Test("whenTheAppReturnsBeforeTheCancelledPromptAnswers_AppLock_ShouldPromptAgainAndIgnoreTheStaleAnswer")
    func quickBackgroundAndReturn() async {
        let auth = FakeDeviceAuthenticator()
        auth.holdPrompts = true
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        let launch = Task { await lock.start() }
        while !auth.isHolding { await Task.yield() }
        // Background and back before the cancelled prompt's answer arrives.
        await lock.activityChanged(.background)
        #expect(!lock.isBusy, "backgrounding ends the prompt's hold")
        let back = Task { await lock.activityChanged(.active) }
        for _ in 0..<1000 where auth.heldCount < 2 { await Task.yield() }
        #expect(auth.prompts == [.unlock, .unlock], "the return asks again")
        #expect(lock.isBusy)

        auth.finish(.success)  // the stale prompt answers late, even with a success
        await launch.value
        #expect(lock.status == .locked, "a pre-background answer never unlocks")
        #expect(lock.isBusy, "and does not end the new prompt's hold")
        #expect(lock.message == nil)

        auth.finish(.success)
        await back.value
        #expect(lock.status == .unlocked)
        #expect(!lock.isBusy)
    }

    @Test("whenUnlockIsTappedTwice_AppLock_ShouldShowOnePrompt")
    func singleFlight() async {
        let auth = FakeDeviceAuthenticator([.cancelled, .success])
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        await lock.start()
        auth.holdPrompts = true
        let first = Task { await lock.unlock() }
        while !auth.isHolding { await Task.yield() }
        await lock.unlock()
        #expect(auth.prompts.count == 2, "the launch prompt and one unlock")
        auth.finish(.success)
        await first.value
        #expect(lock.status == .unlocked)
    }

    @Test("whenOwnPromptMakesTheAppInactive_AppLock_ShouldNotFlashTheCover")
    func ownPrompt() async {
        let auth = FakeDeviceAuthenticator([.success, .success])
        let lock = AppLockController(store: EphemeralAppLockSettingStore(enabled: true), authenticator: auth)
        await lock.start()
        auth.holdPrompts = true
        let change = Task { await lock.setEnabled(false) }
        while !auth.isHolding { await Task.yield() }
        await lock.activityChanged(.inactive)
        #expect(!lock.conceals)
        auth.finish(.success)
        await change.value
        await lock.activityChanged(.active)
        #expect(!lock.isEnabled)
    }

    @Test("whenTurningOn_AppLock_ShouldAuthenticateWithBiometricsThenSaveDurably")
    func enable() async {
        let store = EphemeralAppLockSettingStore()
        let auth = FakeDeviceAuthenticator([.success])
        let lock = AppLockController(store: store, authenticator: auth)
        await lock.start()
        await lock.setEnabled(true)
        #expect(auth.prompts == [.enable])
        #expect(lock.isEnabled && store.stored)
        #expect(lock.status == .unlocked, "turning it on doesn't lock the person out right away")
        // Relaunch: the saved setting locks the new process.
        let relaunched = AppLockController(store: store, authenticator: FakeDeviceAuthenticator([.cancelled]))
        await relaunched.start()
        #expect(relaunched.status == .locked)
    }

    @Test("whenAuthenticationFailsOrIsCancelled_AppLock_ShouldKeepThePreviousSetting")
    func enableRefused() async {
        let store = EphemeralAppLockSettingStore()
        let lock = AppLockController(store: store, authenticator: FakeDeviceAuthenticator([.cancelled, .failed]))
        await lock.start()
        await lock.setEnabled(true)
        #expect(!lock.isEnabled && !store.stored)
        #expect(lock.message == "Cancelled. Your lock setting is unchanged.")
        await lock.setEnabled(true)
        #expect(lock.message == "Face ID didn't recognize you. Try again.")
        #expect(!store.stored)
    }

    @Test("whenTheSettingCantBeSaved_AppLock_ShouldKeepThePreviousSetting")
    func saveFails() async {
        let store = EphemeralAppLockSettingStore(failWrites: .failed(-1))
        let lock = AppLockController(store: store, authenticator: FakeDeviceAuthenticator([.success]))
        await lock.start()
        await lock.setEnabled(true)
        #expect(!lock.isEnabled)
        #expect(lock.message?.contains("previous setting is unchanged") == true)
    }

    @Test("whenBiometricsAreNotEnrolled_AppLock_ShouldExplainAndNotPrompt")
    func notEnrolled() async {
        let auth = FakeDeviceAuthenticator()
        auth.enableAvailability = .notEnrolled
        let lock = AppLockController(store: EphemeralAppLockSettingStore(), authenticator: auth)
        await lock.start()
        await lock.setEnabled(true)
        #expect(auth.prompts.isEmpty)
        #expect(lock.message == "Set up Face ID in Settings first, then try again.")
    }

    @Test("whenBackgroundedWhileTurningOn_AppLock_ShouldComeBackLocked")
    func backgroundWhileEnabling() async {
        let store = EphemeralAppLockSettingStore()
        let auth = FakeDeviceAuthenticator([.success])
        auth.holdPrompts = true
        let lock = AppLockController(store: store, authenticator: auth)
        await lock.start()
        let change = Task { await lock.setEnabled(true) }
        while !auth.isHolding { await Task.yield() }
        await lock.activityChanged(.background)
        auth.finish(.success)
        await change.value
        #expect(store.stored)
        #expect(lock.status == .locked)
    }

    @Test("whenAFailedCheckGivesNoError_LocalDeviceAuthenticator_ShouldNotReportSuccess")
    func nilErrorIsNotSuccess() {
        // canEvaluatePolicy false, or evaluatePolicy success=false, without an error.
        #expect(LocalDeviceAuthenticator.failure(nil) == .unavailable)
        #expect(LocalDeviceAuthenticator.failure(LAError(.userCancel)) == .cancelled)
        #expect(LocalDeviceAuthenticator.failure(LAError(.authenticationFailed)) == .failed)
        #expect(LocalDeviceAuthenticator.failure(LAError(.biometryLockout)) == .lockout)
        #expect(LocalDeviceAuthenticator.failure(CocoaError(.featureUnsupported)) == .failed)
    }

    @Test("whenTheDeviceHasNoPasscode_AppLock_ShouldNameTheRecoveryStep")
    func noPasscode() {
        let message = AppLockController.message(for: .passcodeNotSet, purpose: .unlock, biometry: .faceID)
        #expect(message?.contains("Set a device passcode") == true)
    }
}

@Suite("App lock setting in the Keychain")
struct KeychainAppLockSettingStoreTests {
    @Test("whenNothingIsSaved_KeychainAppLockSettingStore_ShouldReadOff")
    func missing() throws {
        #expect(try KeychainAppLockSettingStore(backend: FakeKeychain()).read() == false)
    }

    @Test("whenSaved_KeychainAppLockSettingStore_ShouldRoundTripOnThisDeviceOnly")
    func roundTrip() throws {
        let keychain = FakeKeychain()
        let store = KeychainAppLockSettingStore(backend: keychain)
        try store.write(true)
        #expect(try store.read())
        try store.write(false)
        #expect(try store.read() == false)
        let item = try #require(keychain.items(service: KeychainAppLockSettingStore.service)["enabled"])
        #expect(!item.isSynchronizable)
        #expect(
            item.attributes[kSecAttrAccessible as String]
                == (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String))
    }

    @Test("whenTheKeychainIsLockedOrTheValueIsForeign_KeychainAppLockSettingStore_ShouldThrow")
    func failures() {
        let keychain = FakeKeychain()
        keychain.put(account: "enabled", data: Data("maybe".utf8), service: KeychainAppLockSettingStore.service)
        let store = KeychainAppLockSettingStore(backend: keychain)
        #expect(throws: AppLockStoreError.corrupt) { try store.read() }
        keychain.forcedStatus.withLock { $0 = errSecInteractionNotAllowed }
        #expect(throws: AppLockStoreError.unavailable) { try store.read() }
    }
}

@Suite("Device preferences")
struct DevicePreferencesTests {
    @Test("whenAppearanceIsSaved_UserDefaultsDevicePreferences_ShouldKeepItForTheNextLaunch")
    func persists() throws {
        let suite = "penny.tests.preferences.\(UUID().uuidString)"
        defer { UserDefaults.standard.removePersistentDomain(forName: suite) }
        #expect(UserDefaultsDevicePreferences(suiteName: suite).appearance == .system)
        UserDefaultsDevicePreferences(suiteName: suite).setAppearance(.dark)
        #expect(UserDefaultsDevicePreferences(suiteName: suite).appearance == .dark)
    }

    @Test(
        "whenALegacyThemeIsImported_AppearancePreference_ShouldMapAmoledAndCatppuccinToDark",
        arguments: [
            ("light", AppearancePreference.light), ("dark", .dark), ("amoled", .dark), ("catppuccin", .dark),
            ("system", .system), ("unknown", .system),
        ])
    func legacy(value: String, expected: AppearancePreference) {
        #expect(AppearancePreference(legacy: value) == expected)
        #expect(AppearancePreference(legacy: nil) == .system)
    }
}
