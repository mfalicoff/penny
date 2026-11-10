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
    /// The ledger behind a signed-in account. MAZ-71 replaces the default with its offline
    /// store and sync engine; until then the account shows a named "not yet" state.
    public var accountWorkspace: (SignedInAccount) -> any LedgerWorkspace
    /// Today's local date (the device's calendar day).
    public var today: () -> CalendarDate

    public init(
        preferences: any DevicePreferences, lock: AppLockController,
        accountWorkspace: @escaping (SignedInAccount) -> any LedgerWorkspace,
        today: @escaping () -> CalendarDate = { CalendarDate(Date()) }
    ) {
        self.preferences = preferences
        self.lock = lock
        self.accountWorkspace = accountWorkspace
        self.today = today
    }

    public static func live() -> AppServices {
        AppServices(
            preferences: UserDefaultsDevicePreferences(), lock: AppLockController(),
            accountWorkspace: { _ in UnavailableWorkspace() })
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
