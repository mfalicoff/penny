import Foundation
import Synchronization

/// Light, dark or the system setting (the default). There are no other appearances: Dark is
/// true black, so the legacy AMOLED theme is dark, and Catppuccin was dropped (MAZ-132).
public enum AppearancePreference: String, CaseIterable, Sendable {
    case system, light, dark

    public var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// A theme the legacy app saved. AMOLED and Catppuccin become dark, as the baseline
    /// decides; anything unknown falls back to the system setting. MAZ-72 calls this when it
    /// imports the Expo app's preferences.
    public init(legacy value: String?) {
        switch value {
        case "light": self = .light
        case "dark", "amoled", "catppuccin": self = .dark
        default: self = .system
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
