public import Foundation
public import Observation
public import PennyData
public import PennyDomain

#if os(iOS)
    public import UIKit
    public import UserNotifications
#else
    import UserNotifications
#endif

/// The system's notification services, behind a protocol so the lifecycle is tested without
/// APNs, a permission prompt or Notification Center.
@MainActor
protocol NotificationSystem: AnyObject {
    func permission() async -> PushPermission
    /// Shows the system prompt (once per install; later calls answer at once). True if allowed.
    func requestPermission() async -> Bool
    /// Asks APNs for this device's token. The answer arrives through the app delegate.
    func registerForRemoteNotifications()
    /// Removes Penny's notifications from Notification Center and clears the badge.
    func removeDeliveredNotifications()
}

/// `UNUserNotificationCenter` and `UIApplication`.
@MainActor
final class SystemNotifications: NotificationSystem {
    func permission() async -> PushPermission {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        default: .allowed
        }
    }

    func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]))
            ?? false
    }

    func registerForRemoteNotifications() {
        #if os(iOS)
            UIApplication.shared.registerForRemoteNotifications()
        #endif
    }

    func removeDeliveredNotifications() {
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.setBadgeCount(0)
    }
}

/// Household notifications (MAZ-79): permission, APNs registration and what a tapped
/// notification opens. One per app process, owned by the app delegate, which forwards the
/// UIKit and UserNotifications callbacks here.
///
/// - **Permission** is asked only in context (the Shared tab once the person is in a household,
///   or Settings), never at launch. Denied is respected: the registration is removed and
///   Settings offers iOS Settings.
/// - **Registration** follows the signed-in account (`PushRegistrar`); the demo never registers.
/// - **Opening** a notification hands its household month or expense to the deep-link inbox,
///   which keeps it until sign-in finishes and the app lock is open. A notification waits for
///   an account (never the demo), and one for another account than the stored registration's
///   is dropped. Changing or leaving the account clears delivered notifications, so the next
///   person never sees or opens the previous one's.
@MainActor
@Observable
public final class PushNotifications {
    public let registrar: PushRegistrar
    /// The person chose Not now on the Shared tab's prompt (this device, `penny.push.promptDismissed`).
    public private(set) var promptDismissed: Bool
    /// A tapped notification waiting for an account to open in.
    private(set) var pending: HouseholdNotification?

    @ObservationIgnored let system: any NotificationSystem
    @ObservationIgnored private let store: PushRegistrationStore
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var account: PushAccount?
    /// Hands a link to the deep-link inbox. `RootView` sets it.
    @ObservationIgnored var deliver: ((DeepLink) -> Void)? {
        didSet { deliverPending() }
    }

    static let promptDismissedKey = "penny.push.promptDismissed"

    init(
        system: any NotificationSystem, environment: PushEnvironment, store: PushRegistrationStore,
        defaults: UserDefaults = .standard
    ) {
        self.system = system
        self.store = store
        self.defaults = defaults
        registrar = PushRegistrar(environment: environment, store: store)
        promptDismissed = defaults.bool(forKey: Self.promptDismissedKey)
    }

    /// The real services.
    public static func live() -> PushNotifications {
        PushNotifications(system: SystemNotifications(), environment: .current(), store: PushRegistrationStore())
    }

    /// Sign-out's `DELETE /api/push/devices` (`AuthController`'s device registration).
    /// When sign-out does not go ahead, the registrar registers the device again.
    public var devices: any DeviceRegistration {
        APNsDeviceRegistration(store: store) { [registrar] in await registrar.resync() }
    }

    /// The account `client` registers as; nil without a session or while the Keychain is locked.
    public func account(for client: APIClient) -> PushAccount? {
        PushAccount(client: client, store: store)
    }

    public var permission: PushPermission { registrar.permission }
    public var hasAccount: Bool { account != nil }

    /// Whether the Shared tab should offer to turn notifications on.
    public var offersPrompt: Bool { account != nil && permission == .notDetermined && !promptDismissed }

    // MARK: Lifecycle

    /// The signed-in account changed (nil while signed out, restoring or in the demo).
    func accountChanged(_ next: PushAccount?) async {
        // The previous account's notifications must not stay on screen for the next person:
        // after an account change in this process, or at launch when the device's registration
        // (which the registrar is about to replace) belongs to another account.
        let changedInProcess = account != nil && account?.owner != next?.owner
        let stored = registrar.owner
        let storedForAnother = next != nil && stored != nil && stored != next?.owner
        if changedInProcess || storedForAnother { system.removeDeliveredNotifications() }
        account = next
        deliverPending()
        await registrar.accountChanged(next)
        if next != nil, registrar.permission == .allowed { system.registerForRemoteNotifications() }
    }

    /// Penny became active: the person may have changed the permission in iOS Settings.
    func becameActive() async {
        let permission = await system.permission()
        await registrar.permissionChanged(permission)
        if permission == .allowed, account != nil { system.registerForRemoteNotifications() }
        await registrar.retry()
    }

    /// Asks for permission (the person chose Turn on). Then registers when allowed.
    public func requestPermission() async {
        _ = await system.requestPermission()
        await becameActive()
    }

    public func dismissPrompt() {
        promptDismissed = true
        defaults.set(true, forKey: Self.promptDismissedKey)
    }

    // MARK: Callbacks

    public func didRegister(deviceToken: Data) async {
        guard let token = PushDeviceToken(deviceToken) else {
            registrar.tokenFailed()
            return
        }
        await registrar.tokenReceived(token)
    }

    public func didFailToRegister() {
        registrar.tokenFailed()
    }

    /// The person opened a notification (cold start or not). `notification` is nil for a
    /// payload that isn't a valid household target: the app then just opens.
    public func didOpen(_ notification: HouseholdNotification?) {
        guard let notification else { return }
        pending = notification
        deliverPending()
    }

    /// Whether a notification that arrives while Penny is in the foreground shows a banner:
    /// only a valid one, while the account the device's token was last registered for is
    /// signed in. Any other owner (another account's, one kept from a sign-out or a denial, or
    /// one made with another device's key) shows none. Only an install that never registered
    /// has no owner; APNs cannot have reached it.
    public func showsInForeground(_ notification: HouseholdNotification?) -> Bool {
        guard notification != nil, let account else { return false }
        return registrar.owner.map { $0 == account.owner } ?? true
    }

    /// Opens the waiting notification once an account is signed in, unless the device's token
    /// was last registered for another account: then it is dropped.
    private func deliverPending() {
        guard let notification = pending, let account, let deliver else { return }
        pending = nil
        if let owner = registrar.owner, owner != account.owner { return }
        deliver(notification.deepLink)
    }
}

#if os(iOS)
    /// The app delegate (`@UIApplicationDelegateAdaptor` in the app target): receives the APNs
    /// token and the notification callbacks, and becomes the notification center's delegate
    /// before launch finishes, so a notification that launched the app is delivered.
    public final class PennyAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
        public let notifications = PushNotifications.live()

        public func application(
            _ application: UIApplication,
            didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
        ) -> Bool {
            UNUserNotificationCenter.current().delegate = self
            return true
        }

        public func application(
            _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
        ) {
            Task { await notifications.didRegister(deviceToken: deviceToken) }
        }

        public func application(
            _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error
        ) {
            notifications.didFailToRegister()
        }

        public nonisolated func userNotificationCenter(
            _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
        ) async {
            guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
            let notification = HouseholdNotification(userInfo: response.notification.request.content.userInfo)
            await notifications.didOpen(notification)
        }

        public nonisolated func userNotificationCenter(
            _ center: UNUserNotificationCenter, willPresent notification: UNNotification
        ) async -> UNNotificationPresentationOptions {
            let target = HouseholdNotification(userInfo: notification.request.content.userInfo)
            return await notifications.showsInForeground(target) ? [.banner, .list, .sound] : []
        }
    }
#endif
