public import Foundation
public import PennyData
public import PennyDomain
import SwiftUI

/// The device services the app shell uses, injected so tests and previews can replace them.
/// `live` is what the app runs with.
@MainActor
public struct AppServices {
    /// Appearance and other per-device, non-secret settings.
    public var preferences: any DevicePreferences
    /// The biometric lock. One per app process.
    public var lock: AppLockController
    /// The ledger behind a signed-in account, given the app's one offline sync model (MAZ-71,
    /// created by `LaunchView`). The default presents the account through `AccountWorkspace`.
    public var accountWorkspace: (SignedInAccount, LedgerSyncModel) -> any LedgerWorkspace
    /// Today's local date (the device's calendar day).
    public var today: @Sendable () -> CalendarDate
    /// Opens the temporary demo at launch. Only Debug test controls set it (UI tests and
    /// screenshots without a server).
    public var startsInDemo = false

    public init(
        preferences: any DevicePreferences, lock: AppLockController,
        accountWorkspace: @escaping (SignedInAccount, LedgerSyncModel) -> any LedgerWorkspace = {
            AccountWorkspace(model: $1, scope: $0.scope)
        },
        today: @escaping @Sendable () -> CalendarDate = { CalendarDate(Date()) }
    ) {
        self.preferences = preferences
        self.lock = lock
        self.accountWorkspace = accountWorkspace
        self.today = today
    }

    /// Keeps the Home Screen widgets' App Group snapshot (MAZ-80). Nil in previews and tests,
    /// and in a build without the App Group entitlement.
    public var widgets: WidgetPublisher?

    /// The real device services.
    public static func live() -> AppServices {
        var services = AppServices(
            preferences: UserDefaultsDevicePreferences(), lock: AppLockController(store: KeychainAppLockSettingStore()))
        services.widgets = WidgetPublisher.live()
        return services
    }
}

/// The appearance setting, applied at the root. `.system` follows the device.
@MainActor
@Observable
final class AppearanceModel {
    private(set) var preference: AppearancePreference
    @ObservationIgnored private let preferences: any DevicePreferences

    init(preferences: any DevicePreferences) {
        self.preferences = preferences
        preference = preferences.appearance
    }

    func set(_ next: AppearancePreference) {
        preferences.setAppearance(next)
        preference = next
    }

    var colorScheme: ColorScheme? {
        switch preference {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
