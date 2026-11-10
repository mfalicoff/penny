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

    var body: some View {
        Form {
            Section {
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
            } header: {
                Text("Server URL")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Enter the server’s base URL, without /api. This only affects this device.")
                    if input.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("http:") {
                        Text(
                            "HTTP is unencrypted and may be blocked by your device. Prefer HTTPS outside a trusted local network."
                        )
                        .foregroundStyle(PennyColor.danger)
                    }
                }
            }

            if let failure {
                Section { AuthMessage(text: failure) }
            }

            if let check {
                verified(check)
            } else {
                Section {
                    Button(action: runCheck) {
                        HStack {
                            Text(checking ? "Checking server…" : "Check server")
                            if checking {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(checking || input.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("server.check")
                }
            }
        }
        .navigationTitle("Penny server")
        .inlineNavigationTitle()
        .onAppear { focused = check == nil }
    }

    private func verified(_ check: ServerCheck) -> some View {
        Group {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Server verified").font(PennyFont.style(.headline))
                        Text(check.isEncrypted ? "Connected securely over HTTPS" : "Not encrypted (HTTP)")
                            .font(PennyFont.style(.footnote))
                            .foregroundStyle(check.isEncrypted ? PennyColor.secondaryLabel : PennyColor.danger)
                    }
                } icon: {
                    Image(systemName: check.isEncrypted ? "checkmark.seal.fill" : "exclamationmark.shield")
                        .foregroundStyle(check.isEncrypted ? PennyColor.income : PennyColor.danger)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("server.verified")
                LabeledContent("Name", value: "Penny")
                LabeledContent("Version", value: check.version)
                LabeledContent("Sign-in", value: Self.methods(check))
            } footer: {
                Text("Switching servers later requires syncing your entries and signing out first.")
            }
            Section {
                Button("Use this server") {
                    do throws(AuthFailure) {
                        try auth.useServer(check)
                        onDone()
                    } catch {
                        failure = error.message
                    }
                }
                .font(PennyFont.style(.headline))
                .accessibilityIdentifier("server.use")
                Button("Check again", action: runCheck)
                    .disabled(checking)
                    .accessibilityIdentifier("server.checkAgain")
            }
        }
    }

    static func methods(_ check: ServerCheck) -> String {
        switch check.singleSignOn {
        case true?: "Email · \(check.singleSignOnLabel ?? "SSO")"
        case false?: "Email"
        case nil: "Email (single sign-on unknown)"
        }
    }

    private func runCheck() {
        guard !checking else { return }
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
