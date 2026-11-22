import Foundation
public import PennyDomain
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

/// Settings that stay on this device and are not synced: the appearance, the Display settings
/// (MAZ-250: Show cents on Home, Reduce transparency, Week starts on, as on the web) and the app
/// lock's delay. Not secret, so they live in the app's preferences. The lock's on/off setting is
/// separate (`AppLockSettingStore`) because it must fail closed; the delay fails closed by
/// reading as `.immediately` when it is missing or unknown.
public protocol DevicePreferences: Sendable {
    var appearance: AppearancePreference { get }
    func setAppearance(_ appearance: AppearancePreference)
    /// Home's Left to spend shows cents (the default) or whole units.
    var showsCents: Bool { get }
    func setShowsCents(_ showsCents: Bool)
    /// Solid surfaces instead of glass, whatever the system's Reduce Transparency says (which
    /// applies too). Off by default.
    var reducesTransparency: Bool { get }
    func setReducesTransparency(_ reducesTransparency: Bool)
    /// The calendar's first column, Monday by default.
    var weekStart: WeekStart { get }
    func setWeekStart(_ weekStart: WeekStart)
    var lockDelay: AppLockDelay { get }
    func setLockDelay(_ delay: AppLockDelay)
}

/// `DevicePreferences` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsDevicePreferences: DevicePreferences {
    static let appearanceKey = "penny.appearance"
    static let showsCentsKey = "penny.showsCents"
    static let reducesTransparencyKey = "penny.reducesTransparency"
    static let weekStartKey = "penny.weekStart"
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

    /// Missing (never set) reads as on, the default.
    public var showsCents: Bool {
        defaults.object(forKey: Self.showsCentsKey) as? Bool ?? true
    }

    public func setShowsCents(_ showsCents: Bool) {
        defaults.set(showsCents, forKey: Self.showsCentsKey)
    }

    public var reducesTransparency: Bool {
        defaults.object(forKey: Self.reducesTransparencyKey) as? Bool ?? false
    }

    public func setReducesTransparency(_ reducesTransparency: Bool) {
        defaults.set(reducesTransparency, forKey: Self.reducesTransparencyKey)
    }

    public var weekStart: WeekStart {
        defaults.string(forKey: Self.weekStartKey).flatMap(WeekStart.init(rawValue:)) ?? .monday
    }

    public func setWeekStart(_ weekStart: WeekStart) {
        defaults.set(weekStart.rawValue, forKey: Self.weekStartKey)
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
        var showsCents = true
        var reducesTransparency = false
        var weekStart = WeekStart.monday
        var lockDelay: AppLockDelay
    }
    private let values: Mutex<Values>

    public init(appearance: AppearancePreference = .system, lockDelay: AppLockDelay = .immediately) {
        values = Mutex(Values(appearance: appearance, lockDelay: lockDelay))
    }

    public var appearance: AppearancePreference { values.withLock { $0.appearance } }
    public func setAppearance(_ appearance: AppearancePreference) { values.withLock { $0.appearance = appearance } }
    public var showsCents: Bool { values.withLock { $0.showsCents } }
    public func setShowsCents(_ showsCents: Bool) { values.withLock { $0.showsCents = showsCents } }
    public var reducesTransparency: Bool { values.withLock { $0.reducesTransparency } }
    public func setReducesTransparency(_ reducesTransparency: Bool) {
        values.withLock { $0.reducesTransparency = reducesTransparency }
    }
    public var weekStart: WeekStart { values.withLock { $0.weekStart } }
    public func setWeekStart(_ weekStart: WeekStart) { values.withLock { $0.weekStart = weekStart } }
    public var lockDelay: AppLockDelay { values.withLock { $0.lockDelay } }
    public func setLockDelay(_ delay: AppLockDelay) { values.withLock { $0.lockDelay = delay } }
}
