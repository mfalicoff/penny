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

/// Settings that stay on this device and are not synced: the appearance. Not secret, so
/// they live in the app's preferences. The app lock setting is separate
/// (`AppLockSettingStore`) because it must fail closed.
public protocol DevicePreferences: Sendable {
    var appearance: AppearancePreference { get }
    func setAppearance(_ appearance: AppearancePreference)
}

/// `DevicePreferences` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsDevicePreferences: DevicePreferences {
    static let appearanceKey = "penny.appearance"

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
}

/// Preferences in memory, for previews and tests.
public final class EphemeralDevicePreferences: DevicePreferences {
    private let value: Mutex<AppearancePreference>

    public init(appearance: AppearancePreference = .system) {
        value = Mutex(appearance)
    }

    public var appearance: AppearancePreference { value.withLock { $0 } }
    public func setAppearance(_ appearance: AppearancePreference) { value.withLock { $0 = appearance } }
}
