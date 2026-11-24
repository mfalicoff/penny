import PennyData
import PennyDesign
import SwiftUI

// Email verification (MAZ-172). Verification only records that the address is proven: nothing
// waits for it, so every screen here says Penny works right away. The emailed link opens the web
// app's /verify-email page (the app doesn't open web links); the app reads the new state from
// the profile when it comes back to the foreground.

/// How long Resend waits after each verification email, as the server and the web do.
enum VerificationResend {
    static let delay: TimeInterval = 60

    static func remaining(sentAt: Date?, now: Date) -> TimeInterval {
        guard let sentAt else { return 0 }
        return max(0, delay - now.timeIntervalSince(sentAt))
    }
}

/// "Check your email" after a password sign-up on a server that sends email (card
/// `iphone-verify-email`): the address, the two steps, Continue to Penny, Resend after a minute
/// and Change email. Shown by the gate instead of the shell until Continue.
struct CheckEmailView: View {
    let auth: AuthController

    @State private var busy = false
    @State private var message: String?
    @State private var changingEmail = false

    private var email: String { auth.state.account?.email ?? "" }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Image(systemName: "envelope")
                    .font(.system(size: 36, weight: .regular))
                    .foregroundStyle(PennyColor.tint)
                    .frame(width: 84, height: 84)
                    .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .shadow(color: Color(red: 0.16, green: 0.12, blue: 0.08).opacity(0.10), radius: 15, y: 10)
                    .accessibilityHidden(true)
                Text("Check your email.")
                    .font(PennyFont.style(.largeTitle))
                    .foregroundStyle(PennyColor.label)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 14)
                Text(
                    "We sent a link to \(Text(email).fontWeight(.semibold).foregroundStyle(PennyColor.label)). Open it on any device to verify your address."
                )
                .font(.callout)
                .foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
                .accessibilityIdentifier("verifyEmail.address")
                steps.padding(.top, 26)
                if let message {
                    AuthMessage(text: message).padding(.top, 14)
                        .accessibilityIdentifier("verifyEmail.message")
                }
                PrimaryButton(title: "Continue to Penny") { auth.continueAfterCheckEmail() }
                    .accessibilityIdentifier("verifyEmail.continue")
                    .padding(.top, 24)
                ResendLine(sentAt: auth.verificationEmailSentAt, busy: busy, action: resend)
                    .padding(.top, 16)
                Button("Change email") { changingEmail = true }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(PennyColor.tintText)
                    .buttonStyle(.plain)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .padding(.top, 2)
                    .disabled(busy)
                    .accessibilityIdentifier("verifyEmail.changeEmail")
            }
            // The card's 24pt sides (`.wrap`), wider than the sign-in screens' gutter.
            .padding(.horizontal, 24)
            .padding(.top, 96)
            .padding(.bottom, Metrics.gutter)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
            .heroGlow(top: -60)
        }
        .signedOutBackground()
        .sheet(isPresented: $changingEmail) {
            ChangeEmailSheet(auth: auth, currentEmail: email) { _ in message = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.checkEmail")
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 0) {
            step(1, "Use Penny right away", "Households, trips and invites included.")
            Divider().overlay(PennyColor.separator).padding(.leading, 50)
            step(2, "Verify your address", "Opening the link shows this email is yours.")
        }
        .padding(.vertical, 4)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func step(_ number: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(PennyColor.label)
                .frame(width: 22, height: 22)
                .background(PennyColor.fill, in: Circle())
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).foregroundStyle(PennyColor.label)
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    private func resend() {
        guard !busy else { return }
        busy = true
        message = nil
        Task {
            message = await auth.resendVerificationEmail()
            busy = false
        }
    }
}

/// "Didn't get it? Resend in 0:42", counting the server's minute down, then a copper Resend.
struct ResendLine: View {
    let sentAt: Date?
    let busy: Bool
    let action: () -> Void

    var body: some View {
        TimelineView(.periodic(from: sentAt ?? .now, by: 1)) { context in
            let left = VerificationResend.remaining(sentAt: sentAt, now: context.date)
            HStack(spacing: 6) {
                Text("Didn't get it?").foregroundStyle(PennyColor.secondaryLabel)
                Button(action: action) {
                    if busy {
                        Text("Sending…")
                    } else if left > 0 {
                        Text("Resend in \(Text(InviteCard.clock(left)).monospacedDigit())")
                    } else {
                        Text("Resend")
                    }
                }
                .buttonStyle(.plain)
                .fontWeight(.semibold)
                .foregroundStyle(left > 0 || busy ? PennyColor.tertiaryLabel : PennyColor.tintText)
                .disabled(left > 0 || busy)
                .accessibilityLabel(left > 0 && !busy ? "Resend in \(Int(left.rounded(.up))) seconds" : "Resend")
                .accessibilityIdentifier("verifyEmail.resend")
            }
            .font(.subheadline)
            .frame(minHeight: Metrics.minTouchTarget)
        }
    }
}

/// Change email (MAZ-172): the new address and the account's password. There is no iPhone card
/// for it: it follows the web's Change your email (in the layout of `iphone-forgot-password`), in
/// the sign-in screens' style. The account moves to the new address with its local data, and a
/// new link goes there; the earlier link stops working.
struct ChangeEmailSheet: View {
    enum Field: Hashable { case email, password }

    let auth: AuthController
    let currentEmail: String
    var onChanged: (WireProfile) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var emailError: String?
    @State private var passwordError: String?
    @State private var failure: String?
    @State private var busy = false
    @FocusState private var focused: Field?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Change your email")
                        .font(PennyFont.style(.largeTitle))
                        .foregroundStyle(PennyColor.label)
                        .accessibilityAddTraits(.isHeader)
                    Text("Enter the address you want to sign in with. We'll send a new link to verify it.")
                        .font(.callout)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 6)
                    if let failure {
                        AuthMessage(text: failure).padding(.top, 14)
                            .accessibilityIdentifier("changeEmail.error")
                    }
                    AuthFieldGroup {
                        AuthFieldRow(label: "Email") {
                            TextField("Email", text: $email, prompt: Text(verbatim: currentEmail))
                                .emailEntry()
                                .submitLabel(.next)
                                .focused($focused, equals: .email)
                                .onSubmit { focused = .password }
                                .accessibilityIdentifier("changeEmail.email")
                        }
                        AuthFieldRow(label: "Password") {
                            SecureField("Password", text: $password, prompt: Text("Your password"))
                                .passwordEntry(new: false)
                                .submitLabel(.send)
                                .focused($focused, equals: .password)
                                .onSubmit(send)
                                .accessibilityIdentifier("changeEmail.password")
                        }
                    }
                    .disabled(busy)
                    .padding(.top, 24)
                    if let emailError { fieldError(emailError) }
                    if let passwordError { fieldError(passwordError) }
                    PrimaryButton(title: busy ? "Sending…" : "Send link", busy: busy, action: send)
                        .disabled(busy)
                        .accessibilityIdentifier("changeEmail.send")
                        .padding(.top, 22)
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(PennyColor.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .disabled(busy)
                        .accessibilityIdentifier("changeEmail.close")
                }
            }
            .pennySolidBars()
        }
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(busy)
        .onAppear {
            focused = .email
        }
        .accessibilityIdentifier("screen.changeEmail")
    }

    private func fieldError(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(PennyColor.danger)
            .padding(.horizontal, 16)
            .padding(.top, 8)
    }

    private func send() {
        guard !busy else { return }
        emailError = nil
        passwordError = nil
        failure = nil
        busy = true
        let address = email
        let secret = password
        Task {
            let outcome = await auth.changeEmail(to: address, password: secret)
            busy = false
            switch outcome {
            case .changed(let profile):
                onChanged(profile)
                dismiss()
            case .invalidEmail(let text):
                emailError = text
                focused = .email
            case .wrongPassword(let text):
                passwordError = text
                password = ""
                focused = .password
            case .failed(let text):
                failure = text
            }
        }
    }
}

/// The Shared tab's reminder for a password account whose email isn't verified yet, while the
/// server sends email (card `iphone-unverified`). Sharing works either way.
struct VerifyEmailReminder: View {
    @Environment(ShellModel.self) private var shell
    let email: String

    @State private var busy = false
    @State private var sent = false
    @State private var message: String?
    @State private var changingEmail = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "envelope")
                    .font(.system(size: 20))
                    .foregroundStyle(PennyColor.pending)
                    .frame(width: 44, height: 44)
                    .background(
                        PennyColor.pending.opacity(0.16), in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Verify your email")
                        .font(.headline)
                        .foregroundStyle(PennyColor.label)
                    Text(
                        "Open the link we sent to \(Text(email).fontWeight(.semibold).foregroundStyle(PennyColor.label)) to show this address is yours. Sharing works either way."
                    )
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    if let message {
                        Text(message).font(.footnote).foregroundStyle(PennyColor.danger)
                    } else if sent {
                        Text("Link sent. Check your inbox.").font(.footnote).foregroundStyle(
                            PennyColor.secondaryLabel)
                    }
                }
                .padding(.top, 1)
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
            }
            HStack(spacing: 10) {
                Button(action: resend) {
                    Text(busy ? "Sending…" : "Resend link")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                        .foregroundStyle(.white)
                        .background(PennyColor.tint, in: Capsule())
                }
                .disabled(busy || sent)
                .opacity(sent ? 0.5 : 1)
                .accessibilityIdentifier("shared.verifyEmail.resend")
                Button {
                    changingEmail = true
                } label: {
                    Text("Change email")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                        .foregroundStyle(PennyColor.label)
                        .background(PennyColor.fill, in: Capsule())
                }
                .disabled(busy)
                .accessibilityIdentifier("shared.verifyEmail.changeEmail")
            }
            .font(.body.weight(.semibold))
            .buttonStyle(.plain)
        }
        .padding(18)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shared.verifyEmail")
        .sheet(isPresented: $changingEmail) {
            if let auth = shell.auth {
                ChangeEmailSheet(auth: auth, currentEmail: email) { profile in shell.profile.adopt(profile) }
            }
        }
    }

    private func resend() {
        guard !busy, let auth = shell.auth else { return }
        busy = true
        message = nil
        Task {
            message = await auth.resendVerificationEmail()
            sent = message == nil
            busy = false
        }
    }
}
