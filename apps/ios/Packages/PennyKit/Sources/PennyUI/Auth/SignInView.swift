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
    /// MAZ-124: Forgot password, with the email typed so far. Shown only while the server sends email.
    var onForgotPassword: (String) -> Void = { _ in }

    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var failure: String?
    /// The provider whose sign-in sheet is open (MAZ-170).
    @State private var waitingFor: SignInProvider.ID?
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
                if providersLead {
                    // `iphone-sign-in-providers`, `iphone-create-account-providers`: every provider
                    // first, then the email form under "or use your email".
                    providerButtons.padding(.top, mode == .signIn ? 22 : 18)
                    OrDivider(text: "or use your email").padding(.vertical, 14)
                    fields
                } else {
                    fields.padding(.top, 28)
                }
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
                .padding(.top, providersLead ? 16 : (mode == .signIn ? 18 : 26))
                // A lone single sign-on follows Sign in only: create account (`iphone-create-account`)
                // has none, and signing in with it creates the account anyway.
                if !providersLead, mode == .signIn { trailingProviders }
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
            // Create account keeps the list sign-in just read, so its layout doesn't jump.
            if mode == .signIn { await auth.refreshSingleSignOn() }
            await auth.refreshServerInfo()
        }
        .onAppear {
            if email.isEmpty, let expiredEmail { email = expiredEmail }
        }
    }

    /// Sign-in leads with the leaf and a centered "Welcome back."; create account has no leaf and
    /// a left-aligned two-line headline, as on the cards. With Apple or Google leading
    /// (`iphone-sign-in-providers`, `iphone-create-account-providers`) the header is tighter: a
    /// smaller leaf and no lede on sign-in, a one-line headline on create account.
    @ViewBuilder
    private var header: some View {
        if mode == .signIn {
            BrandHeader(size: providersLead ? 56 : 64).padding(.top, providersLead ? 6 : 44)
            Text("Welcome back.")
                .font(PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, providersLead ? 14 : 18)
            if !providersLead {
                Text("Sign in to see your month.")
                    .font(.callout)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
            }
        } else {
            Text(providersLead ? "Make yourself at home." : "Make yourself\nat home.")
                .font(providersLead ? .title.weight(.bold) : PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Make yourself at home.")
                .accessibilityAddTraits(.isHeader)
                .padding(.top, providersLead ? 20 : 28)
            Text("Your account lives on this server. Penny never connects to your bank.")
                .font(providersLead ? .subheadline : .callout)
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
        if auth.state == .signedOut(.accountDeleted), mode == .signIn {
            AuthMessage(text: "Your account was deleted, and every device was signed out.", tone: .notice)
                .padding(.top, 20)
                .accessibilityIdentifier("auth.accountDeleted")
        }
        if auth.state == .signedOut(.passwordReset), mode == .signIn {
            AuthMessage(
                text: "Your password changed and every device was signed out. Sign in with the new password.",
                tone: .notice
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
            .overlay(alignment: .topTrailing) {
                // `iphone-sign-in-providers`: Forgot password? on the Password label's line.
                if mode == .signIn, auth.server?.emailEnabled == true {
                    Button("Forgot password?") { onForgotPassword(email) }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PennyColor.tintText)
                        .padding(.horizontal, 16)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .contentShape(Rectangle())
                        .accessibilityIdentifier("auth.forgotPassword")
                }
            }
        }
        .disabled(busy)
    }

    /// The server's providers, in its order (MAZ-170). Empty while unknown or when it lists none.
    private var providers: [SignInProvider] {
        if case .available(let providers) = auth.singleSignOn { return providers }
        return []
    }

    /// Apple or Google present: every provider leads, above the email form.
    private var providersLead: Bool { ProviderText.leads(providers) }

    private var providerButtons: some View {
        ProviderButtons(
            providers: providers, creating: mode == .createAccount,
            waiting: auth.state == .signingIn(.singleSignOn) ? waitingFor : nil, disabled: busy, start: start)
    }

    /// A lone single sign-on follows the form under "or" (`iphone-sign-in`), with the check's
    /// progress and retry in the same place.
    @ViewBuilder
    private var trailingProviders: some View {
        switch auth.singleSignOn {
        case .available:
            VStack(spacing: 18) {
                OrDivider()
                providerButtons
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

    /// Signs in with `provider`: Apple's own sheet for a native provider when this build may use
    /// it (`AppleSignInAuthenticator.isEnabled`), otherwise the provider's page in the system
    /// browser sheet.
    private func start(_ provider: SignInProvider) {
        guard !busy else { return }
        failure = nil
        notice = nil
        focus = nil
        waitingFor = provider.id
        let web = SystemWebAuthenticator(session: webAuthenticationSession)
        Task {
            defer { waitingFor = nil }
            do throws(AuthFailure) {
                let outcome: SignInOutcome
                if provider.native, AppleSignInAuthenticator.isEnabled {
                    outcome = try await auth.signInNatively(with: provider, using: AppleSignInAuthenticator())
                } else {
                    outcome = try await auth.signInWithSingleSignOn(provider: provider, using: web)
                }
                if outcome == .cancelled { notice = Self.cancelledNotice(provider) }
            } catch {
                failure = error.message
            }
        }
    }

    static func cancelledNotice(_ provider: SignInProvider) -> String {
        provider.isBrand
            ? "Sign-in with \(provider.label) was cancelled. You can try again or use your email."
            : "Single sign-on was cancelled. You can try again or use your password."
    }
}
