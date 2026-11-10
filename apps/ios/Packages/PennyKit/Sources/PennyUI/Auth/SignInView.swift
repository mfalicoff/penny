import AuthenticationServices
import PennyData
import PennyDesign
import SwiftUI

/// The `sign-in` and `create-account` specimens, plus `sign-in-sso` (the single sign-on
/// button and its waiting and cancelled states). What the person typed stays in the fields
/// after a failure; only a successful sign-in leaves this screen.
struct SignInView: View {
    enum Mode: Equatable {
        case signIn
        case createAccount
    }

    enum Field: Hashable { case email, password }

    let auth: AuthController
    let mode: Mode
    var onChangeServer: () -> Void
    var onSwitchMode: () -> Void

    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var email = ""
    @State private var password = ""
    @State private var failure: String?
    @State private var notice: String?
    @FocusState private var focus: Field?

    private var busy: Bool {
        if case .signingIn = auth.state { return true }
        return false
    }

    private var expiredEmail: String? {
        if case .signedOut(.sessionExpired(let email)) = auth.state { return email }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ServerChip(server: auth.server, onChange: mode == .signIn ? onChangeServer : nil)
                    .disabled(busy)
                BrandHeader()
                VStack(spacing: 6) {
                    Text(mode == .signIn ? "Welcome back." : "Make yourself at home.")
                        .font(PennyFont.style(.title2))
                        .foregroundStyle(PennyColor.label)
                        .accessibilityAddTraits(.isHeader)
                    Text(
                        mode == .signIn
                            ? "Sign in to see your month."
                            : "Your account lives on this server. Penny never connects to your bank."
                    )
                    .font(PennyFont.style(.subhead))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                }
                if let expiredEmail, mode == .signIn {
                    AuthMessage(
                        text: "Your session for \(expiredEmail) ended. Sign in again to keep syncing; "
                            + "changes on this device are kept.", tone: .notice)
                }
                fields
                if let failure { AuthMessage(text: failure) }
                if let notice { AuthMessage(text: notice, tone: .notice) }
                PrimaryButton(
                    title: busy && auth.state == .signingIn(mode == .signIn ? .password : .registration)
                        ? "One moment…" : (mode == .signIn ? "Sign in" : "Create account"),
                    busy: busy, action: submit
                )
                .disabled(busy || auth.server == nil)
                .accessibilityIdentifier(mode == .signIn ? "auth.signIn" : "auth.createAccount")
                if mode == .signIn { singleSignOn }
                Button(mode == .signIn ? "New here? Create an account" : "Already have an account? Sign in") {
                    failure = nil
                    notice = nil
                    onSwitchMode()
                }
                .font(PennyFont.style(.subhead))
                .frame(minHeight: Metrics.minTouchTarget)
                .disabled(busy)
                .accessibilityIdentifier("auth.switchMode")
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(PennyColor.background)
        .hiddenNavigationBar()
        .task(id: auth.server) {
            if mode == .signIn { await auth.refreshSingleSignOn() }
        }
        .onAppear {
            if email.isEmpty, let expiredEmail { email = expiredEmail }
        }
    }

    private var fields: some View {
        VStack(spacing: 14) {
            AuthField(label: "Email") {
                TextField("Email", text: $email, prompt: Text(verbatim: "you@example.com"))
                    .emailEntry()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
                    .accessibilityIdentifier("auth.email")
            }
            AuthField(label: "Password", footnote: mode == .createAccount ? "At least 10 characters" : nil) {
                SecureField(
                    "Password", text: $password,
                    prompt: Text(mode == .signIn ? "Your password" : "At least 10 characters")
                )
                .passwordEntry(new: mode == .createAccount)
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit(submit)
                .accessibilityIdentifier("auth.password")
            }
        }
        .disabled(busy)
    }

    @ViewBuilder
    private var singleSignOn: some View {
        switch auth.singleSignOn {
        case .available(let label):
            VStack(spacing: 12) {
                Text("or").font(PennyFont.style(.footnote)).foregroundStyle(PennyColor.tertiaryLabel)
                Button(action: startSingleSignOn) {
                    HStack(spacing: 8) {
                        if auth.state == .signingIn(.singleSignOn) { ProgressView() }
                        Text(
                            auth.state == .signingIn(.singleSignOn)
                                ? "Waiting for \(label)…" : "Continue with \(label)")
                    }
                    .font(PennyFont.style(.headline))
                    .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget + 6)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .disabled(busy)
                .accessibilityIdentifier("auth.singleSignOn")
            }
        case .failed:
            Button("Couldn't check single sign-on. Retry") { Task { await auth.refreshSingleSignOn() } }
                .font(PennyFont.style(.subhead))
                .frame(minHeight: Metrics.minTouchTarget)
                .disabled(busy)
                .accessibilityIdentifier("auth.singleSignOnRetry")
        case .checking:
            ProgressView().accessibilityLabel("Checking single sign-on")
        case .unknown, .unavailable:
            EmptyView()
        }
    }

    private func submit() {
        guard !busy else { return }
        failure = nil
        notice = nil
        focus = nil
        let email = email
        let password = password
        Task {
            do throws(AuthFailure) {
                if mode == .signIn {
                    try await auth.signIn(email: email, password: password)
                } else {
                    try await auth.register(email: email, password: password)
                }
            } catch {
                failure = error.message
                focus = error.kind == .invalidCredentials ? .password : nil
            }
        }
    }

    private func startSingleSignOn() {
        guard !busy else { return }
        failure = nil
        notice = nil
        let authenticator = SystemWebAuthenticator(session: webAuthenticationSession)
        Task {
            do throws(AuthFailure) {
                if try await auth.signInWithSingleSignOn(using: authenticator) == .cancelled {
                    notice = "Single sign-on was cancelled. You can try again or use your password."
                }
            } catch {
                failure = error.message
            }
        }
    }
}
