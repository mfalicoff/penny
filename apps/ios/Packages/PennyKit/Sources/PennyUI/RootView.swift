public import PennyData
import PennyDesign
public import PennyDomain
public import SwiftUI

/// The app's root: configuration errors, then the sign-in gate (MAZ-68). The MAZ-69 shell
/// (tab bar on iPhone, split view on iPad) replaces the signed-in placeholder and presents
/// `link`.
public struct RootView: View {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>
    @State private var link: DeepLink?

    public init(configuration: Result<AppConfiguration, AppConfiguration.Invalid>) {
        self.configuration = configuration
    }

    public var body: some View {
        Group {
            switch configuration {
            case .success(let configuration): LaunchView(configuration: configuration, link: link)
            case .failure(let error): ConfigurationErrorView(error: error)
            }
        }
        .tint(PennyColor.tint)
        .onOpenURL { url in
            let parsed = DeepLink(url: url) ?? .home
            // Single sign-on callbacks return through the system authentication session,
            // never through openURL. One arriving here was not requested by this app (or is a
            // replay), so it is ignored rather than redeemed.
            if case .authCallback = parsed { return }
            link = parsed
        }
    }
}

struct LaunchView: View {
    @State private var auth: AuthController
    let link: DeepLink?

    init(configuration: AppConfiguration, link: DeepLink?, auth: AuthController? = nil) {
        _auth = State(initialValue: auth ?? AuthController(defaultServer: configuration.defaultServerURL))
        self.link = link
    }

    var body: some View {
        AuthGate(auth: auth, link: link)
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

#Preview("Sign in") {
    LaunchView(
        configuration: AppConfiguration(
            environment: .development, defaultServerURL: nil, appGroup: AppIdentity.appGroup),
        link: nil,
        auth: AuthController(
            defaultServer: nil, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(server: SavedServer(server: PreviewServer.url, version: "2.0.0"))))
}

#Preview("Choose a server") {
    LaunchView(
        configuration: AppConfiguration(
            environment: .production, defaultServerURL: nil, appGroup: AppIdentity.appGroup),
        link: nil,
        auth: AuthController(
            defaultServer: nil, sessions: EphemeralSessionStore(), preferences: EphemeralAuthPreferences()))
}

#Preview("Configuration error") {
    RootView(configuration: .failure(.missing(AppConfiguration.Key.appGroup)))
}

enum PreviewServer {
    static var url: ServerURL {
        do { return try ServerURL("https://penny.example.com") } catch { preconditionFailure("Invalid preview server") }
    }
}
