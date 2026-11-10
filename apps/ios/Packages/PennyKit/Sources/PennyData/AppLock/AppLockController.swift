public import Observation

/// The app's scene activity, without importing SwiftUI (`ScenePhase` maps onto it).
public enum AppActivity: Equatable, Sendable {
    case active, inactive, background
}

/// The biometric app lock (the legacy `AppLockProvider`, ported to the native app).
///
/// - It fails closed: until the setting has been read, or when reading it fails, the app is
///   concealed. A failed read offers Try again; it never opens the app.
/// - It conceals, never unmounts: the lock is drawn over the app (and over its sheets), so an
///   unsaved draft survives locking.
/// - One prompt at a time. Going to the background cancels the prompt and invalidates its
///   answer, so a success from before backgrounding never unlocks a later session, and ends
///   the one-at-a-time hold at once, so a return that beats the cancellation still prompts.
/// - Inactive and background are applied synchronously (`setActivity`), so the cover is up
///   before the app-switcher snapshot.
/// - The on/off setting changes only after the person authenticates and the new value is
///   saved; a failed save leaves the previous setting in force.
///
/// Widgets and notification previews are outside the lock (MAZ-79/80 keep their contents
/// non-sensitive); the settings screen says so.
@MainActor
@Observable
public final class AppLockController {
    public enum Status: Equatable, Sendable {
        /// Reading the setting at launch.
        case loading
        /// The setting could not be read: concealed, with Try again.
        case unreadable
        case locked
        case unlocked
    }

    public private(set) var status: Status = .loading
    public private(set) var isEnabled = false
    /// A prompt or a setting change is in progress.
    public private(set) var isBusy = false
    /// What went wrong last, worded for the person, with the next step.
    public private(set) var message: String?
    public private(set) var activity: AppActivity

    @ObservationIgnored private let store: any AppLockSettingStore
    @ObservationIgnored private let authenticator: any DeviceAuthenticator
    /// Bumped when the app goes to the background; answers from an older generation are dropped.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var wasBackgrounded = false

    public init(
        store: any AppLockSettingStore = KeychainAppLockSettingStore(),
        authenticator: any DeviceAuthenticator = LocalDeviceAuthenticator(),
        activity: AppActivity = .active
    ) {
        self.store = store
        self.authenticator = authenticator
        self.activity = activity
    }

    public var biometry: BiometryKind { authenticator.biometry }

    /// True while the app's content must be hidden: before the setting is known, when it
    /// can't be read, while locked, and while a locked-capable app is not in the foreground
    /// (the app switcher snapshot). Not while Penny's own prompt makes the app inactive.
    public var conceals: Bool {
        switch status {
        case .loading, .unreadable, .locked: true
        case .unlocked:
            switch activity {
            case .active: false
            case .inactive: isEnabled && !isBusy
            case .background: isEnabled
            }
        }
    }

    /// Reads the setting. Call at launch and from Try again.
    public func start() async {
        guard status == .loading || status == .unreadable else { return }
        do throws(AppLockStoreError) {
            let enabled = try store.read()
            isEnabled = enabled
            message = nil
            status = enabled ? .locked : .unlocked
            if enabled { await unlock() }
        } catch {
            status = .unreadable
            message =
                error == .unavailable
                ? "Unlock your \(Self.deviceName) to open Penny."
                : "Penny couldn't read its lock setting. Try again to open Penny."
        }
    }

    /// Records the scene's activity at once. Call it directly (not from a `Task`) when the
    /// scene becomes inactive or goes to the background, so the cover is up in the same
    /// update, before the system takes the app-switcher snapshot. Going to the background
    /// cancels a prompt and ends its single-flight hold, so a quick return can prompt again;
    /// the cancelled prompt's late answer is dropped by its generation and never unlocks.
    public func setActivity(_ next: AppActivity) {
        activity = next
        guard next == .background else { return }
        generation += 1
        wasBackgrounded = true
        isBusy = false
        authenticator.cancel()
        if isEnabled, status == .unlocked { status = .locked }
    }

    /// `setActivity`, then on `.active` reads a setting that was unreadable, or prompts when
    /// the app came back locked.
    public func activityChanged(_ next: AppActivity) async {
        setActivity(next)
        switch next {
        case .background, .inactive:
            break
        case .active:
            let returned = wasBackgrounded
            wasBackgrounded = false
            if status == .unreadable {
                await start()
            } else if status == .locked, returned || message == nil {
                // The prompt itself makes the app inactive without backgrounding it. After a
                // cancelled or failed prompt (a message is showing) only a real return from the
                // background asks again by itself; otherwise the person taps Unlock.
                await unlock()
            }
        }
    }

    /// Asks for biometrics (or the passcode) and opens the app on success.
    public func unlock() async {
        guard status == .locked, !isBusy, activity == .active else { return }
        let attempt = beginBusy()
        defer { endBusy(attempt) }
        let result = await authenticator.authenticate(.unlock, reason: "Unlock Penny")
        guard attempt == generation, status == .locked else { return }
        if result == .success {
            status = .unlocked
            message = nil
        } else {
            message = Self.message(for: result, purpose: .unlock, biometry: biometry)
        }
    }

    /// Turns the lock on or off after the person authenticates, then saves it durably.
    public func setEnabled(_ next: Bool) async {
        guard !isBusy, next != isEnabled, status == .unlocked else { return }
        message = nil
        if next {
            let available = authenticator.canEnable()
            guard available == .success else {
                message = Self.message(for: available, purpose: .enable, biometry: biometry)
                return
            }
        }
        let attempt = beginBusy()
        defer { endBusy(attempt) }
        let purpose: AuthenticationPurpose = next ? .enable : .disable
        let result = await authenticator.authenticate(
            purpose, reason: next ? "Turn on the lock for Penny" : "Turn off the lock for Penny")
        guard result == .success else {
            message = Self.message(for: result, purpose: purpose, biometry: biometry)
            return
        }
        do throws(AppLockStoreError) {
            try store.write(next)
        } catch {
            message = "Penny couldn't save this setting. Your previous setting is unchanged."
            return
        }
        isEnabled = next
        // Backgrounded while saving: the app must come back locked.
        if next, attempt != generation || activity == .background { status = .locked }
    }

    /// Marks a prompt or setting change in progress and returns its generation.
    private func beginBusy() -> Int {
        isBusy = true
        return generation
    }

    /// Ends the hold from `beginBusy`, unless the app went to the background since: that
    /// already ended it, and a newer prompt may hold it now.
    private func endBusy(_ attempt: Int) {
        if attempt == generation { isBusy = false }
    }

    static let deviceName = "device"

    public static func message(
        for result: AuthenticationResult, purpose: AuthenticationPurpose, biometry: BiometryKind
    ) -> String? {
        let name = biometry == .none ? "Face ID" : biometry.name
        switch result {
        case .success: return nil
        case .cancelled:
            return purpose == .unlock ? "Unlock was cancelled." : "Cancelled. Your lock setting is unchanged."
        case .failed: return "\(name) didn't recognize you. Try again."
        case .lockout:
            return purpose == .unlock
                ? "\(name) is locked after too many tries. Use your passcode to unlock."
                : "\(name) is locked after too many tries. Unlock your device with its passcode, then try again."
        case .notEnrolled: return "Set up \(name) in Settings first, then try again."
        case .passcodeNotSet:
            return "Set a device passcode in Settings › \(name) & Passcode, then come back to unlock Penny."
        case .unavailable: return "\(name) isn't available right now. Check your device settings and try again."
        }
    }
}
