import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Shows the signed-out flow, the launch states, the signed-in shell or the demo for the auth
/// state. The demo replaces whatever is shown until it ends, and never touches the account or
/// the offline ledger: only a signed-in account's shell is given the sync model.
struct AuthGate: View {
    let auth: AuthController
    /// The app's one offline ledger and sync model (MAZ-71), read by each account's shell
    /// through `AccountWorkspace`.
    let sync: LedgerSyncModel
    @Binding var inbox: DeepLinkInbox
    let services: AppServices
    @Binding var demo: DemoWorkspace?

    @Environment(\.scenePhase) private var scenePhase
    @Environment(PushNotifications.self) private var push: PushNotifications?

    var body: some View {
        Group {
            if let demo {
                ShellHost(
                    inbox: $inbox,
                    session: .demo,
                    makeModel: {
                        let shell = ShellModel(
                            workspace: demo, session: .demo, today: services.today(), clock: services.today,
                            leaveDemo: { self.demo = nil })
                        shell.now = services.now
                        return shell
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
                case .signedIn where auth.showsCheckEmail:
                    // MAZ-172: right after a password sign-up on a server that sends email.
                    // Its own stack, as the signed-out flow has, so its screen identifier is its own.
                    NavigationStack { CheckEmailView(auth: auth).hiddenNavigationBar() }
                case .signedIn(let account), .signingOut(let account):
                    ShellHost(
                        inbox: $inbox,
                        session: Self.session(account),
                        makeModel: {
                            let shell = ShellModel(
                                workspace: services.accountWorkspace(account, sync), session: .account(auth, account),
                                today: services.today(), clock: services.today, startDemo: startDemo,
                                search: auth.client.map { AccountEntrySearch(model: sync, client: $0) },
                                sharedProjection: auth.client.map {
                                    APISharedProjection(client: $0) { auth.sessionDidExpire(for: account) }
                                },
                                households: auth.client.map {
                                    APIHouseholdService(client: $0) { auth.sessionDidExpire(for: account) }
                                })
                            shell.receipts = AccountReceipts(auth: auth, account: account, sync: sync)
                            // Emailed receipts (MAZ-184): online-only, like uploads.
                            shell.receiptInbox = ReceiptInboxModel(
                                service: auth.client.map {
                                    APIReceiptInboxService(client: $0) { auth.sessionDidExpire(for: account) }
                                },
                                available: { sync.canUseOnlineOnlyActions })
                            shell.receiptAttacher = ReceiptAttacher(
                                workspace: shell.workspace,
                                households: auth.client.map {
                                    APIHouseholdService(client: $0) { auth.sessionDidExpire(for: account) }
                                },
                                email: account.email)
                            // Names and pictures (MAZ-171).
                            let profiles = auth.client.map {
                                APIProfileService(client: $0) { auth.sessionDidExpire(for: account) }
                            }
                            shell.profile = ProfileModel(service: profiles)
                            shell.avatars = AvatarStore(service: profiles)
                            shell.widgets = services.widgets
                            shell.now = services.now
                            return shell
                        }
                    )
                    .id(account.scope)
                }
            }
        }
        .onChange(of: currentSession, initial: true) {
            inbox.sessionChanged(to: currentSession)
            // Receipt previews and picked files left by a crash or the previous account (MAZ-78).
            ReceiptFileCache.standard.purge()
            // Push registration follows the signed-in account; the demo never registers (MAZ-79).
            let account = pushAccount
            if let push { Task { await push.accountChanged(account) } }
        }
        // The widgets show only the signed-in account's money: signing out clears them, and
        // another account's snapshot is removed before its shell publishes (MAZ-80). Kept
        // apart from the demo, which never touches them.
        .onChange(of: WidgetPublisher.owner(auth.state), initial: true) { _, owner in
            services.widgets?.ownerChanged(owner)
        }
        .task { await auth.restore() }
        .onChange(of: scenePhase) {
            if scenePhase == .active, auth.state == .keychainUnavailable { Task { await auth.restore() } }
        }
    }

    /// The session on screen, so a link that arrives now is kept for it (`DeepLinkInbox`).
    private var currentSession: DeepLinkSession? {
        if demo != nil { return .demo }
        switch auth.state {
        case .signedIn(let account), .signingOut(let account): return Self.session(account)
        case .restoring, .keychainUnavailable, .signedOut, .signingIn: return nil
        }
    }

    /// The account push notifications register for: only a signed-in account, never the demo.
    private var pushAccount: PushAccount? {
        guard let push, demo == nil, case .signedIn = auth.state else { return nil }
        return auth.client.flatMap(push.account(for:))
    }

    static func session(_ account: SignedInAccount) -> DeepLinkSession {
        .account("\(account.scope.server.description) \(account.scope.email.lowercased())")
    }

    private func startDemo() {
        demo = DemoWorkspace(today: services.today())
    }
}

/// Creates the shell's model once and hands it pending deep links when the app is unlocked.
struct ShellHost: View {
    @Binding var inbox: DeepLinkInbox
    /// Who this shell shows: it opens only links for it (`DeepLinkInbox.take`).
    let session: DeepLinkSession
    let makeModel: () -> ShellModel
    @State private var model: ShellModel?
    @Environment(AppLockController.self) private var lock
    @Environment(InviteHandoff.self) private var invites: InviteHandoff?

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
        .onChange(of: invites?.invite) { deliver() }
    }

    /// Opens a waiting link once the shell exists and the lock is open; never behind the lock,
    /// and never one meant for another account.
    private func deliver() {
        deliverInvite()
        guard let model, let link = inbox.take(ready: !lock.conceals, for: session) else { return }
        model.open(link)
    }

    /// A waiting invite opens the join sheet in an account's shell (never in the demo, never
    /// behind the lock). One kept for a sign-in on another server waits for that server's account.
    private func deliverInvite() {
        guard let model, let invites, !lock.conceals, let account = model.account else { return }
        if let waiting = invites.invite, waiting.waitsForSignIn,
            waiting.server.flatMap({ try? ServerURL($0) }) == account.server
        {
            invites.signedIn()
        }
        guard let invite = invites.takeForShell(by: "\(session)") else { return }
        model.navigate { $0.open(.join(code: invite.code, server: invite.server)) }
    }
}

/// Sign in, create an account and choose a server, with the temporary demo at the bottom. Changing
/// the server opens a sheet with a grabber and Close (`iphone-server-connect`, MAZ-257).
struct SignedOutFlow: View {
    let auth: AuthController
    var onTryDemo: (() -> Void)?

    enum Route: Hashable { case createAccount, forgotPassword(email: String), resetPassword }

    @State private var path: [Route] = []
    @State private var keyboardShown = false
    @State private var changingServer = false

    /// The demo link rides above the keyboard, where it covered Sign in while typing at every
    /// text size (MAZ-82 audit at AX-XXXL, MAZ-179 at the default size); it steps aside until the
    /// keyboard goes away.
    private var showsTryDemo: Bool { !keyboardShown }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if auth.server == nil {
                    ServerConnectView(auth: auth) {}
                } else {
                    SignInView(
                        auth: auth, mode: .signIn, onChangeServer: { changingServer = true },
                        onSwitchMode: { path.append(.createAccount) },
                        onForgotPassword: { path.append(.forgotPassword(email: $0)) })
                }
            }
            .safeAreaInset(edge: .top) {
                InviteSignInCard(auth: auth)
            }
            .safeAreaInset(edge: .bottom) {
                if showsTryDemo {
                    VStack(spacing: 0) {
                        if let onTryDemo { tryDemo(onTryDemo) }
                        // MAZ-169: the server's privacy policy, under the sample-data link.
                        if auth.server != nil, let policy = auth.server?.privacyPolicy {
                            PrivacyPolicyLink(url: policy)
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .createAccount:
                    SignInView(
                        auth: auth, mode: .createAccount, onChangeServer: {}, onSwitchMode: { path.removeAll() })
                case .forgotPassword(let email):
                    ForgotPasswordView(
                        auth: auth, initialEmail: email,
                        onEnterCode: { path = [.resetPassword] }, onBack: { path.removeAll() })
                case .resetPassword:
                    ResetPasswordView(auth: auth) { path.removeAll() }
                }
            }
            .pennySolidBars()
        }
        .sheet(isPresented: $changingServer) {
            NavigationStack {
                ServerConnectView(auth: auth) {
                    changingServer = false
                    path.removeAll()
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { changingServer = false }
                            .neutralToolbarGlyph()
                            .accessibilityIdentifier("server.close")
                    }
                }
                .pennySolidBars()
            }
            .presentationDragIndicator(.visible)
        }
        #if canImport(UIKit)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                keyboardShown = true
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                keyboardShown = false
            }
        #endif
    }

    private func tryDemo(_ onTryDemo: @escaping () -> Void) -> some View {
        Button(action: onTryDemo) {
            // The card: label-colored text after an outlined copper play icon.
            Label {
                Text("Take a look around with sample data")
                    .foregroundStyle(PennyColor.label)
            } icon: {
                Image(systemName: "play")
                    .foregroundStyle(PennyColor.tintText)
            }
            .font(.subheadline.weight(.semibold))
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens a temporary demo. Nothing is saved.")
        .accessibilityIdentifier("auth.tryDemo")
    }
}
