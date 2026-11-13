public import PennyData
import PennyDesign
public import PennyDomain
public import SwiftUI

/// The app's root: configuration errors, then the sign-in gate (MAZ-68) and the shell
/// (MAZ-69). It owns what is per device rather than per account: the appearance, the app
/// lock that covers everything, and deep links waiting for sign-in and unlock.
public struct RootView: View {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>
    @State private var services: AppServices
    @State private var appearance: AppearanceModel
    @State private var inbox = DeepLinkInbox()
    /// A `penny://join` invite waiting for the right account (MAZ-75).
    @State private var invites: InviteHandoff
    /// Household notifications (MAZ-79): permission, APNs registration and opened notifications.
    private let notifications: PushNotifications?
    @Environment(\.scenePhase) private var scenePhase

    public init(
        configuration: Result<AppConfiguration, AppConfiguration.Invalid>, services: AppServices = .live(),
        notifications: PushNotifications? = nil
    ) {
        self.configuration = configuration
        self.notifications = notifications
        _services = State(initialValue: services)
        _appearance = State(initialValue: AppearanceModel(preferences: services.preferences))
        let development = (try? configuration.get())?.environment == .development
        _invites = State(initialValue: InviteHandoff(allowsLoopbackHTTP: development))
    }

    public var body: some View {
        Group {
            switch configuration {
            case .success(let configuration):
                LaunchView(
                    configuration: configuration, inbox: $inbox, services: services, notifications: notifications)
            case .failure(let error): ConfigurationErrorView(error: error)
            }
        }
        .tint(PennyColor.tint)
        .preferredColorScheme(appearance.colorScheme)
        .environment(appearance)
        .environment(invites)
        .environment(services.lock)
        .environment(notifications)
        .modifier(LockCover(lock: services.lock))
        .task { await services.lock.start() }
        .onAppear {
            // Opened notifications go through the same inbox as links: kept until sign-in and unlock.
            let inbox = $inbox
            notifications?.deliver = { inbox.wrappedValue.receive($0) }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Self.forward(phase, to: services.lock)
            if phase == .active, let notifications { Task { await notifications.becameActive() } }
        }
        .onOpenURL { url in
            // Unknown penny:// routes open Home. Single sign-on callbacks return through the
            // system authentication session, never through openURL; one arriving here was not
            // requested by this app (or is a replay), so the inbox ignores it.
            let link = DeepLink(url: url) ?? .home
            // Invites name their server, so they wait for an account on it (`InviteHandoff`).
            if case .join(let code, let server) = link {
                invites.receive(code: code, server: server)
            } else {
                inbox.receive(link)
            }
        }
    }

    /// Tells the lock about a scene-phase change. Inactive and background are applied in the
    /// same update, so the cover is drawn before the system takes the app-switcher snapshot;
    /// only `.active`, which may prompt, waits for a task.
    static func forward(_ phase: ScenePhase, to lock: AppLockController) {
        let activity = activity(phase)
        guard activity == .active else {
            lock.setActivity(activity)
            return
        }
        Task { await lock.activityChanged(.active) }
    }

    static func activity(_ phase: ScenePhase) -> AppActivity {
        switch phase {
        case .active: .active
        case .background: .background
        default: .inactive
        }
    }
}

struct LaunchView: View {
    @State private var auth: AuthController
    /// The signed-in account's offline ledger and sync state (MAZ-71).
    @State private var sync: LedgerSyncModel
    @State private var demo: DemoWorkspace?
    @Binding var inbox: DeepLinkInbox
    let services: AppServices
    let notifications: PushNotifications?

    init(
        configuration: AppConfiguration, inbox: Binding<DeepLinkInbox>, services: AppServices,
        notifications: PushNotifications? = nil, auth: AuthController? = nil
    ) {
        // The store records due recurrence with the same day the screens use (a pinned day in UI tests).
        let store = OfflineLedgerStore.standard(today: services.today)
        let auth =
            auth
            ?? AuthController(
                defaultServer: configuration.defaultServerURL, localData: store,
                devices: notifications?.devices ?? NoDeviceRegistration())
        _auth = State(initialValue: auth)
        _sync = State(initialValue: LedgerSyncModel(auth: auth, store: store))
        _demo = State(initialValue: services.startsInDemo ? DemoWorkspace(today: services.today()) : nil)
        _inbox = inbox
        self.services = services
        self.notifications = notifications
    }

    var body: some View {
        AuthGate(auth: auth, sync: sync, inbox: $inbox, services: services, demo: $demo)
            .ledgerSync(sync)
            .accessibilityIdentifier("root.launch")
    }
}

struct ConfigurationErrorView: View {
    let error: AppConfiguration.Invalid

    var body: some View {
        ContentUnavailableView {
            Label("Penny can't start", systemImage: "exclamationmark.triangle")
        } description: {
            Text(Self.message(for: error))
        }
        .accessibilityIdentifier("root.configurationError")
    }

    static func message(for error: AppConfiguration.Invalid) -> String {
        switch error {
        case .missing(let key): "This build is missing the \(key) setting. Rebuild it from apps/ios."
        case .invalidValue(let key): "This build has an invalid \(key) setting. Rebuild it from apps/ios."
        }
    }
}

enum PreviewServer {
    static var url: ServerURL {
        do { return try ServerURL("https://penny.example.com") } catch { preconditionFailure("Invalid preview server") }
    }
}
