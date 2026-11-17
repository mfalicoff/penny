import Foundation
import Synchronization

/// Light, dark or the system setting (the default). There are no other appearances: Dark is
/// true black (MAZ-132).
public enum AppearancePreference: String, CaseIterable, Sendable {
    case system, light, dark

    public var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

/// How long Penny can stay in the background before the app lock asks again (MAZ-133, the
/// `app-lock` card's Lock after). The delay counts from when Penny goes to the background; a
/// cold launch always asks, whatever the delay.
public enum AppLockDelay: String, CaseIterable, Sendable {
    case immediately, oneMinute, fiveMinutes

    public var title: String {
        switch self {
        case .immediately: "Immediately"
        case .oneMinute: "After 1 minute"
        case .fiveMinutes: "After 5 minutes"
        }
    }

    /// The delay in lock-delay minutes (`AppLockController.minute`, 60 seconds outside UI tests).
    public var minutes: Int {
        switch self {
        case .immediately: 0
        case .oneMinute: 1
        case .fiveMinutes: 5
        }
    }
}

/// Settings that stay on this device and are not synced: the appearance and the app lock's
/// delay. Not secret, so they live in the app's preferences. The lock's on/off setting is
/// separate (`AppLockSettingStore`) because it must fail closed; the delay fails closed by
/// reading as `.immediately` when it is missing or unknown.
public protocol DevicePreferences: Sendable {
    var appearance: AppearancePreference { get }
    func setAppearance(_ appearance: AppearancePreference)
    var lockDelay: AppLockDelay { get }
    func setLockDelay(_ delay: AppLockDelay)
}

/// `DevicePreferences` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsDevicePreferences: DevicePreferences {
    static let appearanceKey = "penny.appearance"
    static let lockDelayKey = "penny.lockDelay"

    private let suiteName: String?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults {
        suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    public var appearance: AppearancePreference {
        defaults.string(forKey: Self.appearanceKey).flatMap(AppearancePreference.init(rawValue:)) ?? .system
    }

    public func setAppearance(_ appearance: AppearancePreference) {
        defaults.set(appearance.rawValue, forKey: Self.appearanceKey)
    }

    public var lockDelay: AppLockDelay {
        defaults.string(forKey: Self.lockDelayKey).flatMap(AppLockDelay.init(rawValue:)) ?? .immediately
    }

    public func setLockDelay(_ delay: AppLockDelay) {
        defaults.set(delay.rawValue, forKey: Self.lockDelayKey)
    }
}

/// Preferences in memory, for previews and tests.
public final class EphemeralDevicePreferences: DevicePreferences {
    private struct Values {
        var appearance: AppearancePreference
        var lockDelay: AppLockDelay
    }
    private let values: Mutex<Values>

    public init(appearance: AppearancePreference = .system, lockDelay: AppLockDelay = .immediately) {
        values = Mutex(Values(appearance: appearance, lockDelay: lockDelay))
    }

    public var appearance: AppearancePreference { values.withLock { $0.appearance } }
    public func setAppearance(_ appearance: AppearancePreference) { values.withLock { $0.appearance = appearance } }
    public var lockDelay: AppLockDelay { values.withLock { $0.lockDelay } }
    public func setLockDelay(_ delay: AppLockDelay) { values.withLock { $0.lockDelay = delay } }
}
