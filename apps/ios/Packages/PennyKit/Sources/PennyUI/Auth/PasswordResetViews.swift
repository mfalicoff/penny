import PennyData
import PennyDesign
import SwiftUI

/// Forgot password (MAZ-124, card `iphone-forgot-password`): the email the person signs in
/// with, then "Check your email", which reads the same whether or not the address has an
/// account, and Resend after a minute. Only reachable while the server sends email; a server
/// that stopped (404) opens the reset code screen instead. The emailed link opens the web app,
/// which takes the new password.
struct ForgotPasswordView: View {
    let auth: AuthController
    var initialEmail = ""
    var onEnterCode: () -> Void
    var onBack: () -> Void

    /// How long Resend waits after each request, as on the web.
    static let resendDelay: TimeInterval = 60

    @State private var email = ""
    @State private var sentTo: String?
    @State private var sentAt: Date?
    @State private var busy = false
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                GlassIconButton("Back", systemImage: "chevron.backward", action: onBack)
                    .disabled(busy)
                    .accessibilityIdentifier("auth.back")
                ServerChip(server: auth.server)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
                Text("Reset your\npassword.")
                    .font(PennyFont.style(.largeTitle))
                    .foregroundStyle(PennyColor.label)
                    .accessibilityLabel("Reset your password.")
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 28)
                Text("Enter the email you sign in with. We'll send a link to choose a new password.")
                    .font(.callout)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                AuthFieldGroup {
                    AuthFieldRow(label: "Email") {
                        TextField("Email", text: $email, prompt: Text(verbatim: "you@example.com"))
                            .emailEntry()
                            .submitLabel(.send)
                            .focused($focused)
                            .onSubmit(send)
                            .disabled(sentTo != nil)
                            .accessibilityIdentifier("auth.email")
                    }
                }
                .disabled(busy)
                .padding(.top, 24)
                if let sentTo { sentNote(sentTo).padding(.top, 18) }
                if let failure { AuthMessage(text: failure).padding(.top, 14) }
                if let sentAt {
                    ResendButton(sentAt: sentAt, busy: busy, action: send)
                        .padding(.top, 16)
                } else {
                    PrimaryButton(title: busy ? "Sending…" : "Send reset link", busy: busy, action: send)
                        .disabled(busy || auth.server == nil)
                        .accessibilityIdentifier("auth.sendResetLink")
                        .padding(.top, 22)
                    AuthLink(
                        lead: "Have a reset code from your server's administrator?", action: "Enter it",
                        perform: onEnterCode
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                    .disabled(busy)
                    .accessibilityIdentifier("auth.enterResetCode")
                }
                AuthLink(lead: "Remembered it?", action: "Sign in", perform: onBack)
                    .frame(maxWidth: .infinity)
                    .padding(.top, sentAt == nil ? 0 : 10)
                    .disabled(busy)
                    .accessibilityIdentifier("auth.switchMode")
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
            .heroGlow(top: -60)
        }
        .scrollDismissesKeyboard(.interactively)
        .signedOutBackground()
        .hiddenNavigationBar()
        .onAppear { if email.isEmpty { email = initialEmail } }
        .accessibilityIdentifier("screen.forgotPassword")
    }

    /// "Check your email": the same words whether or not the address has an account.
    private func sentNote(_ address: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "envelope")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(PennyColor.tintText)
                .frame(width: 36, height: 36)
                .background(PennyColor.tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Check your email")
                    .font(PennyFont.style(.headline))
                    .foregroundStyle(PennyColor.label)
                Text(
                    "If \(address) has a Penny account on this server, a reset link is on its way. The link works once."
                )
                .font(PennyFont.style(.subhead))
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("auth.resetSent")
        .onAppear {
            AccessibilityNotification.Announcement(
                "Check your email. If \(address) has an account, a link is on its way."
            )
            .post()
        }
    }

    private func send() {
        guard !busy else { return }
        failure = nil
        focused = false
        let address = sentTo ?? email
        busy = true
        Task {
            defer { busy = false }
            do throws(AuthFailure) {
                switch try await auth.requestPasswordReset(email: address) {
                case .sent:
                    sentTo = address.trimmingCharacters(in: .whitespacesAndNewlines)
                    sentAt = Date()
                case .emailOff:
                    onEnterCode()
                }
            } catch {
                failure = error.message
                if error.kind == .invalidInput, sentTo == nil { focused = true }
            }
        }
    }
}

/// "Resend in 0:42" on the cards' disabled glass capsule, counting down from a minute after each
/// request, then Resend.
private struct ResendButton: View {
    let sentAt: Date
    let busy: Bool
    let action: () -> Void

    var body: some View {
        TimelineView(.periodic(from: sentAt, by: 1)) { context in
            let left = max(0, ForgotPasswordView.resendDelay - context.date.timeIntervalSince(sentAt))
            let waiting = left > 0 || busy
            Button(action: action) {
                Group {
                    if busy {
                        Text("Sending…")
                    } else if left > 0 {
                        Text("Resend in \(Text(InviteCard.clock(left)).monospacedDigit())")
                    } else {
                        Text("Resend")
                    }
                }
                .font(PennyFont.style(.headline))
                .foregroundStyle(waiting ? PennyColor.tertiaryLabel : PennyColor.label)
                .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget + 6)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .background(waiting ? PennyColor.fill : Color.clear, in: Capsule())
            .pennyGlass(in: Capsule())
            .disabled(waiting)
            .accessibilityLabel(left > 0 && !busy ? "Resend in \(Int(left.rounded(.up))) seconds" : "Resend")
            .accessibilityIdentifier("auth.resend")
        }
    }
}

/// A new password from a reset code (MAZ-123, MAZ-124). There is no iPhone card for this screen:
/// it follows `web-password-reset` (Reset code and New password only, as the owner decided) in
/// the iPhone sign-in screens' style. The code comes from the server's administrator, or from a
/// reset email opened on this phone. Success returns to sign-in, which says every device was
/// signed out.
struct ResetPasswordView: View {
    enum Field: Hashable { case code, password }

    let auth: AuthController
    var onBack: () -> Void

    @State private var code = ""
    @State private var password = ""
    @State private var busy = false
    @State private var failure: String?
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                GlassIconButton("Back", systemImage: "chevron.backward", action: onBack)
                    .disabled(busy)
                    .accessibilityIdentifier("auth.back")
                ServerChip(server: auth.server)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
                Text("Set a new\npassword.")
                    .font(PennyFont.style(.largeTitle))
                    .foregroundStyle(PennyColor.label)
                    .accessibilityLabel("Set a new password.")
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 28)
                Text("Enter the reset code your Penny server's administrator gave you, then choose a new password.")
                    .font(.callout)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                AuthFieldGroup {
                    AuthFieldRow(label: "Reset code") {
                        TextField("Reset code", text: $code, prompt: Text("From your administrator"))
                            .textContentType(.oneTimeCode)
                            .autocorrectionDisabled()
                            #if os(iOS)
                                .textInputAutocapitalization(.never)
                            #endif
                            .monospacedDigit()
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .submitLabel(.next)
                            .focused($focus, equals: .code)
                            .onSubmit { focus = .password }
                            .accessibilityIdentifier("auth.resetCode")
                    }
                    AuthFieldRow(label: "New password") {
                        SecureField("New password", text: $password, prompt: Text("At least 10 characters"))
                            .passwordEntry(new: true)
                            .submitLabel(.go)
                            .focused($focus, equals: .password)
                            .onSubmit(submit)
                            .accessibilityIdentifier("auth.newPassword")
                    }
                }
                .disabled(busy)
                .padding(.top, 24)
                PasswordRule(password: password).padding(.top, 10)
                if let failure { AuthMessage(text: failure).padding(.top, 14) }
                PrimaryButton(title: busy ? "Setting password…" : "Set password", busy: busy, action: submit)
                    .disabled(busy || auth.server == nil)
                    .accessibilityIdentifier("auth.setPassword")
                    .padding(.top, 22)
                AuthLink(lead: "Remembered it?", action: "Sign in", perform: onBack)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                    .disabled(busy)
                    .accessibilityIdentifier("auth.switchMode")
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
            .heroGlow(top: -60)
        }
        .scrollDismissesKeyboard(.interactively)
        .signedOutBackground()
        .hiddenNavigationBar()
        .accessibilityIdentifier("screen.resetPassword")
    }

    private func submit() {
        guard !busy else { return }
        failure = nil
        let code = code
        let password = password
        guard PasswordResetCode.looksValid(code) else {
            failure = PasswordResetCode.invalidFormat
            focus = .code
            return
        }
        guard (10...256).contains(password.utf16.count) else {
            failure = "Use a password of 10–256 characters."
            focus = .password
            return
        }
        focus = nil
        busy = true
        Task {
            defer { busy = false }
            do throws(AuthFailure) {
                try await auth.resetPassword(code: code, password: password)
                onBack()
            } catch {
                failure = error.message
                focus = error.kind == .invalidCode ? .code : (error.kind == .invalidInput ? .password : nil)
            }
        }
    }
}

/// "At least 10 characters" with its dot, then a checkmark once met (`web-password-reset`).
private struct PasswordRule: View {
    let password: String

    var body: some View {
        let met = PasswordStrength.meetsLength(password)
        Label {
            Text("At least \(PasswordStrength.minimumLength) characters")
        } icon: {
            Image(systemName: met ? "checkmark" : "circle.fill")
                .font(.system(size: met ? 11 : 6, weight: .semibold))
                .foregroundStyle(met ? PennyColor.secondaryLabel : PennyColor.tertiaryLabel)
        }
        .labelStyle(.titleAndIcon)
        .font(.footnote)
        .foregroundStyle(PennyColor.secondaryLabel)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("At least \(PasswordStrength.minimumLength) characters")
        .accessibilityValue(met ? "Met" : "Not met")
        .accessibilityIdentifier("auth.passwordRule")
    }
}
