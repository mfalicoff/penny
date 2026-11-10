import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Shows the signed-out flow, the launch states or the signed-in content for the auth
/// state. The signed-in content is a placeholder until the MAZ-69 shell replaces it.
struct AuthGate: View {
    let auth: AuthController
    let link: DeepLink?

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch auth.state {
            case .restoring:
                ProgressView("Opening Penny…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(PennyColor.background)
                    .accessibilityIdentifier("auth.restoring")
            case .keychainUnavailable:
                ContentUnavailableView {
                    Label("Unlock to continue", systemImage: "lock")
                } description: {
                    Text("Penny keeps your sign-in in the Keychain, which opens after you unlock this device.")
                } actions: {
                    Button("Try again") { Task { await auth.restore() } }
                }
                .accessibilityIdentifier("auth.keychainUnavailable")
            case .signedOut, .signingIn:
                SignedOutFlow(auth: auth)
            case .signedIn(let account), .signingOut(let account):
                SignedInPlaceholder(auth: auth, account: account, link: link)
            }
        }
        .task { await auth.restore() }
        .onChange(of: scenePhase) {
            if scenePhase == .active, auth.state == .keychainUnavailable { Task { await auth.restore() } }
        }
    }
}

/// Sign in, create an account and choose a server.
struct SignedOutFlow: View {
    let auth: AuthController

    enum Route: Hashable { case createAccount, server }

    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if auth.server == nil {
                    ServerConnectView(auth: auth) {}
                } else {
                    SignInView(
                        auth: auth, mode: .signIn, onChangeServer: { path.append(.server) },
                        onSwitchMode: { path.append(.createAccount) })
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .createAccount:
                    SignInView(
                        auth: auth, mode: .createAccount, onChangeServer: {}, onSwitchMode: { path.removeAll() })
                case .server:
                    ServerConnectView(auth: auth) { path.removeAll() }
                }
            }
        }
    }
}

/// Signed-in content until MAZ-69: the account, its read-only server and sign-out.
struct SignedInPlaceholder: View {
    let auth: AuthController
    let account: SignedInAccount
    let link: DeepLink?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Signed in as", value: account.email)
                        .accessibilityIdentifier("home.account")
                    NavigationLink("Server") { ServerInfoView(account: account, server: auth.server) }
                        .accessibilityIdentifier("home.serverInfo")
                } footer: {
                    Text("The native app is being built.")
                }
                if let link {
                    Section {
                        Text(String(describing: link))
                            .font(PennyFont.style(.footnote))
                            .foregroundStyle(PennyColor.tertiaryLabel)
                            .accessibilityIdentifier("root.deepLink")
                    }
                }
                Section { SignOutButton(auth: auth) }
            }
            .navigationTitle("Penny")
        }
        .accessibilityIdentifier("root.signedIn")
    }
}
