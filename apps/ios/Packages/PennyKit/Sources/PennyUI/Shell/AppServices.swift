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
    public var today: () -> CalendarDate
    /// Opens the temporary demo at launch. Only Debug test controls set it (UI tests and
    /// screenshots without a server).
    public var startsInDemo = false

    public init(
        preferences: any DevicePreferences, lock: AppLockController,
        accountWorkspace: @escaping (SignedInAccount, LedgerSyncModel) -> any LedgerWorkspace = {
            AccountWorkspace(model: $1, scope: $0.scope)
        },
        today: @escaping () -> CalendarDate = { CalendarDate(Date()) }
    ) {
        self.preferences = preferences
        self.lock = lock
        self.accountWorkspace = accountWorkspace
        self.today = today
    }

    /// What the Expo data import did at this launch (MAZ-72), for diagnostics. Nil when it did
    /// not run (previews, tests).
    public var expoMigration: ExpoMigrationReport?

    /// The real device services. First imports the Expo app's data in place (MAZ-72), before
    /// the lock, the sign-in state or the offline store read anything; the lock stays
    /// concealed until the Expo lock setting has been applied. `importingExpoData: false`
    /// is only for Debug upgrade rehearsals that stage Expo data at this launch: nothing is
    /// imported until the next launch.
    public static func live(importingExpoData: Bool = true) -> AppServices {
        let native = KeychainAppLockSettingStore()
        guard importingExpoData else {
            return AppServices(preferences: UserDefaultsDevicePreferences(), lock: AppLockController(store: native))
        }
        let migration = ExpoMigration.live(lockStore: native)
        let report = migration.run()
        var services = AppServices(
            preferences: UserDefaultsDevicePreferences(),
            lock: AppLockController(store: ExpoImportingLockStore(native: native, migration: migration)))
        services.expoMigration = report
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
