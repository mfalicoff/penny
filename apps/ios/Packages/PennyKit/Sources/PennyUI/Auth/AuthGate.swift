import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Shows the signed-out flow, the launch states, the signed-in shell or the demo for the auth
/// state. The demo replaces whatever is shown until it ends, and never touches the account.
struct AuthGate: View {
    let auth: AuthController
    @Binding var inbox: DeepLinkInbox
    let services: AppServices
    @Binding var demo: DemoWorkspace?

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if let demo {
                ShellHost(
                    inbox: $inbox,
                    makeModel: {
                        ShellModel(
                            workspace: demo, session: .demo, today: services.today(), leaveDemo: { self.demo = nil })
                    }
                )
                .id(ObjectIdentifier(demo))
            } else {
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
                    SignedOutFlow(auth: auth, onTryDemo: startDemo)
                case .signedIn(let account), .signingOut(let account):
                    ShellHost(
                        inbox: $inbox,
                        makeModel: {
                            ShellModel(
                                workspace: services.accountWorkspace(account), session: .account(auth, account),
                                today: services.today(), startDemo: startDemo)
                        }
                    )
                    .id(account.scope)
                }
            }
        }
        .task { await auth.restore() }
        .onChange(of: scenePhase) {
            if scenePhase == .active, auth.state == .keychainUnavailable { Task { await auth.restore() } }
        }
    }

    private func startDemo() {
        demo = DemoWorkspace(today: services.today())
    }
}

/// Creates the shell's model once and hands it pending deep links when the app is unlocked.
struct ShellHost: View {
    @Binding var inbox: DeepLinkInbox
    let makeModel: () -> ShellModel
    @State private var model: ShellModel?
    @Environment(AppLockController.self) private var lock

    var body: some View {
        Group {
            if let model {
                AppShell(shell: model)
            } else {
                Color.clear
            }
        }
        .onAppear {
            if model == nil { model = makeModel() }
            deliver()
        }
        .onChange(of: inbox) { deliver() }
        .onChange(of: lock.conceals) { deliver() }
    }

    /// Opens a waiting link once the shell exists and the lock is open; never behind the lock.
    private func deliver() {
        guard let model, let link = inbox.take(ready: !lock.conceals) else { return }
        model.route.open(link)
    }
}

/// Sign in, create an account and choose a server, with the temporary demo at the bottom.
struct SignedOutFlow: View {
    let auth: AuthController
    var onTryDemo: (() -> Void)?

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
            .safeAreaInset(edge: .bottom) {
                if let onTryDemo {
                    Button(action: onTryDemo) {
                        Label("Take a look around with sample data", systemImage: "play.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: Metrics.minTouchTarget)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PennyColor.tintText)
                    .padding(.bottom, 8)
                    .accessibilityHint("Opens a temporary demo. Nothing is saved.")
                    .accessibilityIdentifier("auth.tryDemo")
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
