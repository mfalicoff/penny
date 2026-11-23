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

    enum Field: Hashable { case name, email, password }

    let auth: AuthController
    let mode: Mode
    var onChangeServer: () -> Void
    var onSwitchMode: () -> Void

    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var name = ""
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
            VStack(alignment: mode == .signIn ? .center : .leading, spacing: 0) {
                if mode == .createAccount {
                    GlassIconButton("Back", systemImage: "chevron.backward", action: back)
                        .disabled(busy)
                        .accessibilityIdentifier("auth.back")
                }
                ServerChip(server: auth.server, onChange: mode == .signIn ? onChangeServer : nil)
                    .disabled(busy)
                    .frame(maxWidth: .infinity)
                    .padding(.top, mode == .signIn ? 0 : 14)
                header
                notices
                fields.padding(.top, 28)
                if mode == .createAccount { PasswordStrengthView(password: password) }
                if let failure { AuthMessage(text: failure).padding(.top, 14) }
                if let notice { AuthMessage(text: notice, tone: .notice).padding(.top, 14) }
                PrimaryButton(
                    title: busy && auth.state == .signingIn(mode == .signIn ? .password : .registration)
                        ? "One moment…" : (mode == .signIn ? "Sign in" : "Create account"),
                    busy: busy, action: submit
                )
                .disabled(busy || auth.server == nil)
                .accessibilityIdentifier(mode == .signIn ? "auth.signIn" : "auth.createAccount")
                .padding(.top, mode == .signIn ? 18 : 26)
                if mode == .signIn { singleSignOn }
                // MAZ-169: the agreement under Create account (`iphone-create-account`).
                if mode == .createAccount, let policy = auth.server?.privacyPolicy {
                    Text(PrivacyPolicyText.agreement(policy))
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                        .accessibilityIdentifier("legal.privacyPolicy")
                }
                AuthLink(
                    lead: mode == .signIn ? "New here?" : "Already have an account?",
                    action: mode == .signIn ? "Create an account" : "Sign in",
                    perform: mode == .signIn ? switchMode : back
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
                .disabled(busy)
                .accessibilityIdentifier("auth.switchMode")
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
            // Both cards have the tinted glow behind their header (`sign-in`, `create-account`).
            .heroGlow(top: -60)
        }
        .scrollDismissesKeyboard(.interactively)
        .signedOutBackground()
        .hiddenNavigationBar()
        .task(id: auth.server?.server) {
            if mode == .signIn { await auth.refreshSingleSignOn() }
            await auth.refreshServerInfo()
        }
        .onAppear {
            if email.isEmpty, let expiredEmail { email = expiredEmail }
        }
    }

    /// Sign-in leads with the leaf and a centered "Welcome back."; create account has no leaf and
    /// a left-aligned two-line headline, as on the cards.
    @ViewBuilder
    private var header: some View {
        if mode == .signIn {
            BrandHeader().padding(.top, 44)
            Text("Welcome back.")
                .font(PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 18)
            Text("Sign in to see your month.")
                .font(.callout)
                .foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
        } else {
            Text("Make yourself\nat home.")
                .font(PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .accessibilityLabel("Make yourself at home.")
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 28)
            Text("Your account lives on this server. Penny never connects to your bank.")
                .font(.callout)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
        }
    }

    @ViewBuilder
    private var notices: some View {
        if let expiredEmail, mode == .signIn {
            AuthMessage(
                text: "Your session for \(expiredEmail) ended. Sign in again to keep syncing; "
                    + "changes on this device are kept.", tone: .notice
            )
            .padding(.top, 20)
        }
        if let leftover = auth.unremovedLocalData, mode == .signIn {
            VStack(alignment: .leading, spacing: 8) {
                AuthMessage(text: Self.unremovedMessage(email: leftover.email))
                Button("Remove them now") { Task { await auth.removeUnremovedLocalData() } }
                    .font(PennyFont.style(.subhead).weight(.semibold))
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityIdentifier("auth.removeLeftoverData")
            }
            .padding(.top, 20)
        }
    }

    private func switchMode() {
        failure = nil
        notice = nil
        onSwitchMode()
    }

    /// Create account's back button and its "Sign in" link both return to sign-in.
    private func back() { switchMode() }

    static func unremovedMessage(email: String) -> String {
        "You're signed out, but entries for \(email) couldn't be removed from this device."
    }

    private var fields: some View {
        AuthFieldGroup {
            // MAZ-171: the name people see, first in create account.
            if mode == .createAccount {
                AuthFieldRow(label: "Name") {
                    TextField("Name", text: $name, prompt: Text("What people call you"))
                        .personNameEntry()
                        .submitLabel(.next)
                        .focused($focus, equals: .name)
                        .onSubmit { focus = .email }
                        .accessibilityIdentifier("auth.name")
                }
            }
            AuthFieldRow(label: "Email") {
                TextField("Email", text: $email, prompt: Text(verbatim: "you@example.com"))
                    .emailEntry()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
                    .accessibilityIdentifier("auth.email")
            }
            AuthFieldRow(label: "Password") {
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

    /// The cards' neutral glass capsule with a key: "Continue with SSO". VoiceOver also hears
    /// the provider the server names.
    @ViewBuilder
    private var singleSignOn: some View {
        switch auth.singleSignOn {
        case .available(let label):
            VStack(spacing: 18) {
                OrDivider()
                Button(action: startSingleSignOn) {
                    HStack(spacing: 8) {
                        if auth.state == .signingIn(.singleSignOn) {
                            ProgressView()
                        } else {
                            Image(systemName: "key").accessibilityHidden(true)
                        }
                        Text(auth.state == .signingIn(.singleSignOn) ? "Waiting for \(label)…" : "Continue with SSO")
                    }
                    .font(PennyFont.style(.headline))
                    .foregroundStyle(PennyColor.label)
                    .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget + 8)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .pennyGlass(in: Capsule())
                .disabled(busy)
                .accessibilityLabel(
                    auth.state == .signingIn(.singleSignOn) ? "Waiting for \(label)" : "Continue with SSO, \(label)"
                )
                .accessibilityIdentifier("auth.singleSignOn")
            }
            .padding(.top, 18)
        case .failed:
            Button("Couldn't check single sign-on. Retry") { Task { await auth.refreshSingleSignOn() } }
                .font(PennyFont.style(.subhead))
                .frame(minHeight: Metrics.minTouchTarget)
                .disabled(busy)
                .accessibilityIdentifier("auth.singleSignOnRetry")
                .padding(.top, 10)
        case .checking:
            ProgressView().accessibilityLabel("Checking single sign-on").padding(.top, 18)
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
        let name = name
        if mode == .createAccount {
            // The name is asked here, as on the web, so a new account isn't asked again over Home.
            switch DisplayName.validate(name) {
            case .valid: break
            case .empty:
                failure = "Enter the name people in your households and trips will see."
                focus = .name
                return
            case .invalid(let message):
                failure = message
                focus = .name
                return
            }
        }
        Task {
            do throws(AuthFailure) {
                if mode == .signIn {
                    try await auth.signIn(email: email, password: password)
                } else {
                    try await auth.register(email: email, password: password, displayName: name)
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
