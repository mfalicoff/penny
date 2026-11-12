import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A household invite that arrived while signed out (MAZ-75). For the server this device uses,
/// it says to sign in first; for another server it asks before connecting there. Connecting runs
/// only the usual server check (`/api/info`, no credentials) and changes the server sign-in
/// uses; no session from any server is ever sent to another. A malformed or plain-HTTP link
/// is refused. After sign-in, the shell opens the join sheet with the code.
struct InviteSignInCard: View {
    let auth: AuthController
    @Environment(InviteHandoff.self) private var invites: InviteHandoff?
    @State private var connecting = false
    @State private var failure: String?

    var body: some View {
        if let invites, let invite = invites.invite {
            content(invites, invite)
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 8)
                .accessibilityIdentifier("householdStart.otherServer")
        }
    }

    @ViewBuilder
    private func content(_ invites: InviteHandoff, _ invite: InviteHandoff.Invite) -> some View {
        let parsed = try? InviteLink(
            code: invite.code, server: invite.server, allowsLoopbackHTTP: invites.allowsLoopbackHTTP)
        VStack(alignment: .leading, spacing: 10) {
            if let parsed {
                switch parsed.target(current: auth.server?.server) {
                case .current:
                    StatusBanner(
                        tone: .info, title: "Sign in to join the household",
                        message: "You were invited to a household. After you sign in, the code is filled in.")
                case .other(let server):
                    StatusBanner(
                        tone: .info, title: "Connect to \(ServerText.host(server)) to join?",
                        message: "The invite is for \(server.description). Penny checks that it's a Penny server, "
                            + "then you sign in there. Nothing from any other server is sent to it.")
                    if let failure {
                        Text(failure).font(.footnote).foregroundStyle(PennyColor.danger)
                    }
                    HStack {
                        Button {
                            Task { await connect(server) }
                        } label: {
                            ProgressLabel(title: "Connect to \(ServerText.host(server))", working: connecting)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(connecting || !auth.state.canChangeServer)
                        .accessibilityIdentifier("householdStart.useOtherServer")
                        Button("Not now") { invites.clear() }
                            .buttonStyle(.bordered)
                    }
                }
            } else {
                StatusBanner(
                    tone: .error, title: "This invite link can't be used",
                    message: "Ask for a new invite, or type the code after you sign in.")
                Button("Dismiss") { invites.clear() }.buttonStyle(.bordered)
            }
        }
    }

    private func connect(_ server: ServerURL) async {
        connecting = true
        defer { connecting = false }
        failure = nil
        do throws(AuthFailure) {
            let check = try await auth.checkServer(server.description)
            try auth.useServer(check)
            invites?.signedIn()
        } catch {
            failure = error.message
        }
    }
}
