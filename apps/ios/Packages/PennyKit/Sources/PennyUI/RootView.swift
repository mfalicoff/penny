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
    @Environment(\.scenePhase) private var scenePhase

    public init(
        configuration: Result<AppConfiguration, AppConfiguration.Invalid>, services: AppServices = .live()
    ) {
        self.configuration = configuration
        _services = State(initialValue: services)
        _appearance = State(initialValue: AppearanceModel(preferences: services.preferences))
    }

    public var body: some View {
        Group {
            switch configuration {
            case .success(let configuration):
                LaunchView(configuration: configuration, inbox: $inbox, services: services)
            case .failure(let error): ConfigurationErrorView(error: error)
            }
        }
        .tint(PennyColor.tint)
        .preferredColorScheme(appearance.colorScheme)
        .environment(appearance)
        .environment(services.lock)
        .modifier(LockCover(lock: services.lock))
        .task { await services.lock.start() }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Task { await services.lock.activityChanged(Self.activity(phase)) }
        }
        .onOpenURL { url in
            // Unknown penny:// routes open Home. Single sign-on callbacks return through the
            // system authentication session, never through openURL; one arriving here was not
            // requested by this app (or is a replay), so the inbox ignores it.
            inbox.receive(DeepLink(url: url) ?? .home)
        }
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
    @State private var demo: DemoWorkspace?
    @Binding var inbox: DeepLinkInbox
    let services: AppServices

    init(
        configuration: AppConfiguration, inbox: Binding<DeepLinkInbox>, services: AppServices,
        auth: AuthController? = nil
    ) {
        _auth = State(initialValue: auth ?? AuthController(defaultServer: configuration.defaultServerURL))
        _inbox = inbox
        self.services = services
    }

    var body: some View {
        AuthGate(auth: auth, inbox: $inbox, services: services, demo: $demo)
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
