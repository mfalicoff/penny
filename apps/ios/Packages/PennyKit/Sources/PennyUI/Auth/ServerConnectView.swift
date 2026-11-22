import PennyData
import PennyDesign
import SwiftUI

/// The `server-connect` and `server-verified` specimens: enter a server, check it without
/// sending any credential, then use it. Only reachable while signed out.
struct ServerConnectView: View {
    let auth: AuthController
    var onDone: () -> Void

    @State private var input: String
    @State private var check: ServerCheck?
    @State private var failure: String?
    @State private var checking = false
    @FocusState private var focused: Bool

    init(auth: AuthController, onDone: @escaping () -> Void) {
        self.auth = auth
        self.onDone = onDone
        _input = State(initialValue: auth.server?.server.description ?? "")
    }

    private var isBlank: Bool { input.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                urlField
                caption
                if let failure { AuthMessage(text: failure).padding(.top, 14) }
                if let check {
                    verified(check)
                } else {
                    PrimaryButton(
                        title: checking ? "Checking server…" : "Check server", busy: checking, action: runCheck
                    )
                    .disabled(checking || isBlank)
                    .accessibilityIdentifier("server.check")
                    .padding(.top, 22)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 6)
            .padding(.bottom, Metrics.gutter)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .signedOutBackground()
        .navigationTitle("Penny server")
        .inlineNavigationTitle()
        .onAppear { focused = check == nil }
    }

    /// The URL with its label inside the field and a clear (×) button, as on the card.
    private var urlField: some View {
        AuthFieldGroup {
            AuthFieldRow(label: "Server URL") {
                TextField("Server URL", text: $input, prompt: Text(verbatim: "https://penny.example.com"))
                    .urlEntry()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit(runCheck)
                    .onChange(of: input) {
                        check = nil
                        failure = nil
                    }
                    .disabled(checking)
                    .accessibilityIdentifier("server.url")
            } trailing: {
                if !input.isEmpty, !checking {
                    Button {
                        input = ""
                        focused = true
                    } label: {
                        Image(systemName: "xmark")
                            .font(.body)
                            .foregroundStyle(PennyColor.tertiaryLabel)
                            .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, -10)
                    .accessibilityLabel("Clear server URL")
                    .accessibilityIdentifier("server.clear")
                }
            }
        }
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Enter the server’s base URL, without /api. This only affects this device.")
                .foregroundStyle(PennyColor.secondaryLabel)
            if input.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("http:") {
                Text(
                    "HTTP is unencrypted and may be blocked by your device. Prefer HTTPS outside a trusted local network."
                )
                .foregroundStyle(PennyColor.danger)
            }
        }
        .font(.footnote)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 6)
        .padding(.top, 8)
    }

    private func verified(_ check: ServerCheck) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    VerifiedBadge(encrypted: check.isEncrypted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Server verified").font(PennyFont.style(.headline)).foregroundStyle(PennyColor.label)
                        Text(check.isEncrypted ? "Connected securely over HTTPS" : "Not encrypted (HTTP)")
                            .font(.footnote)
                            .foregroundStyle(check.isEncrypted ? PennyColor.secondaryLabel : PennyColor.danger)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("server.verified")
                detail("Name", "Penny")
                detail("Version", check.version)
                detail("Sign-in", Self.methods(check))
            }
            .padding(16)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.top, 18)

            Label {
                Text("Switching servers later requires syncing your entries and signing out first.")
                    .foregroundStyle(PennyColor.label)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle").foregroundStyle(PennyColor.pending)
            }
            .font(.footnote)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PennyColor.pending.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.top, 14)

            PrimaryButton(title: "Use this server") {
                do throws(AuthFailure) {
                    try auth.useServer(check)
                    onDone()
                } catch {
                    failure = error.message
                }
            }
            .accessibilityIdentifier("server.use")
            .padding(.top, 22)

            Button("Check again", action: runCheck)
                .font(PennyFont.style(.body))
                .foregroundStyle(PennyColor.secondaryLabel)
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                .contentShape(Rectangle())
                .disabled(checking)
                .accessibilityIdentifier("server.checkAgain")
                .padding(.top, 6)
        }
    }

    /// A `.kv` row: the name in the label color, the value bold, over a hairline.
    private func detail(_ name: String, _ value: String) -> some View {
        VStack(spacing: 11) {
            Rectangle().fill(PennyColor.separator).frame(height: 0.5)
            HStack {
                Text(name).foregroundStyle(PennyColor.label)
                Spacer(minLength: 12)
                Text(value).fontWeight(.semibold).foregroundStyle(PennyColor.label)
                    .multilineTextAlignment(.trailing)
            }
            .font(.subheadline)
        }
        .padding(.top, 11)
        .accessibilityElement(children: .combine)
    }

    static func methods(_ check: ServerCheck) -> String {
        switch check.singleSignOn {
        case true?: "Email · SSO"
        case false?: "Email"
        case nil: "Email (single sign-on unknown)"
        }
    }

    private func runCheck() {
        guard !checking, !isBlank else { return }
        checking = true
        failure = nil
        check = nil
        let input = input
        Task {
            defer { checking = false }
            do throws(AuthFailure) {
                check = try await auth.checkServer(input)
            } catch {
                failure = error.message
            }
        }
    }
}

/// Server verified's badge (`.ok .badge`): a check in a circle on a light green tile, or, over
/// plain HTTP, a warning on a light red one.
private struct VerifiedBadge: View {
    let encrypted: Bool
    @ScaledMetric(relativeTo: .body) private var size = 40.0

    var body: some View {
        let color = encrypted ? PennyColor.income : PennyColor.danger
        Image(systemName: encrypted ? "checkmark.circle" : "exclamationmark.shield")
            .font(.system(size: size * 0.55))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(
                (encrypted ? PaletteToken.incomeSoft : PaletteToken.dangerSoft).value.color,
                in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// The `server-info` specimen: the signed-in server, read-only.
struct ServerInfoView: View {
    let account: SignedInAccount
    let server: SavedServer?

    var body: some View {
        Form {
            Section {
                LabeledContent("Server", value: account.server.description)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("serverInfo.url")
                if let version = server?.version { LabeledContent("Version", value: version) }
                LabeledContent(
                    "Connection",
                    value: account.server.url.scheme == "https" ? "Encrypted (HTTPS)" : "Not encrypted (HTTP)")
                LabeledContent("Account", value: account.email)
                LabeledContent("Status", value: account.isVerified ? "Connected" : "Not confirmed yet (offline)")
            } footer: {
                Text("Saved on this device. To change servers, sync your entries and sign out first.")
            }
        }
        .navigationTitle("Server")
    }
}
