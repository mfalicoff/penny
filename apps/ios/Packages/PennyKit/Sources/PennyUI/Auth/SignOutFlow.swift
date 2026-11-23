import PennyData
import PennyDesign
import SwiftUI

/// The `sign-out` specimen as a reusable flow: a sign-out button that asks first in Penny's
/// centered confirmation (`sign-out` and `sign-out-plain` cards: the icon tile, then "Sync, then
/// sign out", "Sign out anyway" and "Cancel" with unsynced changes, or "Sign out" and "Cancel"
/// without), and an actionable alert
/// when the server cannot be reached or the sync fails. Nothing is removed until the person
/// chooses to. MAZ-69's settings sheet places this button.
struct SignOutButton: View {
    let auth: AuthController

    @State private var pending = 0
    /// How many unsynced changes the person agreed to lose ("Sign out anyway"), 0 otherwise.
    @State private var discardConsent = 0
    /// The confirmation, with the pending count it was asked for.
    @State private var confirming: Confirmation?
    @State private var problem: Problem?

    struct Confirmation: Equatable {
        let pending: Int
    }

    enum Problem: Identifiable, Equatable {
        case unreachable
        case syncFailed
        var id: Self { self }
    }

    private var host: String { auth.state.account.map { ServerText.host($0.server) } ?? "the server" }
    private var signingOut: Bool {
        if case .signingOut = auth.state { return true }
        return false
    }

    var body: some View {
        Button(role: .destructive) {
            Task {
                pending = await auth.pendingChangeCount()
                confirming = Confirmation(pending: pending)
            }
        } label: {
            // Centered, as on the `settings` cards.
            HStack(spacing: 8) {
                Text(signingOut ? "Signing out…" : "Sign out").fontWeight(.medium)
                if signingOut { ProgressView() }
            }
            .frame(maxWidth: .infinity)
        }
        .disabled(signingOut || auth.state.account == nil)
        .accessibilityIdentifier("auth.signOut")
        .centeredConfirmation($confirming) { confirmation in
            confirmationContent(pending: confirmation.pending)
        }
        .alert(
            problem == .syncFailed ? "Couldn't sync your changes" : "Couldn't reach \(host)",
            isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } }), presenting: problem
        ) { problem in
            if problem == .unreachable {
                Button("Try again") { run(.signOut(discardingUpTo: discardConsent, evenIfUnreachable: false)) }
                Button("Remove from this \(SyncBanner.deviceName)", role: .destructive) {
                    run(.signOut(discardingUpTo: discardConsent, evenIfUnreachable: true))
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { problem in
            switch problem {
            case .syncFailed:
                Text("Nothing was removed. Check your connection and try again.")
            case .unreachable:
                Text(
                    "You're still signed in and nothing was removed. Try again when you're online, or remove this "
                        + "account from this \(SyncBanner.deviceName) now; the server keeps that session until it expires."
                )
            }
        }
    }

    static func title(pending: Int, host: String) -> String {
        pending == 0
            ? "Sign out of Penny?" : (pending == 1 ? "1 change hasn’t synced" : "\(pending) changes haven’t synced")
    }

    /// "Signing out removes your entries from this iPhone. Synced entries stay safe on <host>."
    static func message(pending: Int, host: String, device: String = "iPhone") -> String {
        let base = "Signing out removes your entries from this \(device). Synced entries stay safe on \(host)"
        guard pending > 0 else { return base + "." }
        return base + "; \(pending == 1 ? "this one" : "these \(pending)") would be lost."
    }

    private func confirmationContent(pending: Int) -> CenteredConfirmationContent {
        let actions: [ConfirmationAction] =
            if pending > 0 {
                [
                    ConfirmationAction("Sync, then sign out", style: .primary, identifier: "signOut.sync") {
                        discardConsent = 0
                        run(.syncThenSignOut)
                    },
                    ConfirmationAction("Sign out anyway", style: .destructive, identifier: "signOut.anyway") {
                        discardConsent = pending
                        run(.signOut(discardingUpTo: pending, evenIfUnreachable: false))
                    },
                    ConfirmationAction("Cancel", style: .cancel, identifier: "signOut.cancel"),
                ]
            } else {
                [
                    ConfirmationAction("Sign out", style: .destructive, identifier: "signOut.confirm") {
                        discardConsent = 0
                        run(.signOut(discardingUpTo: 0, evenIfUnreachable: false))
                    },
                    ConfirmationAction("Cancel", style: .cancel, identifier: "signOut.cancel"),
                ]
            }
        return CenteredConfirmationContent(
            symbol: pending > 0 ? "icloud.slash" : "rectangle.portrait.and.arrow.right",
            tone: pending > 0 ? .pending : .danger, title: Self.title(pending: pending, host: host),
            message: Self.message(pending: pending, host: host, device: SyncBanner.deviceName), actions: actions,
            identifier: "screen.signOutConfirm")
    }

    enum Action {
        case syncThenSignOut
        /// Sign out, or again after the server was unreachable, with the count the person
        /// agreed to lose (`discardConsent`). `AuthController` checks it against the pending
        /// count while saves are held, and asks again (`pendingChanges`) if more are pending.
        case signOut(discardingUpTo: Int, evenIfUnreachable: Bool)
    }

    private func run(_ action: Action) {
        Task {
            do throws(SignOutFailure) {
                switch action {
                case .syncThenSignOut:
                    try await auth.syncThenSignOut()
                case .signOut(let consented, let evenIfUnreachable):
                    try await auth.signOut(
                        discardingUpTo: consented, removeEvenIfUnreachable: evenIfUnreachable)
                }
            } catch {
                switch error {
                case .serverUnreachable: problem = .unreachable
                case .syncFailed: problem = .syncFailed
                case .pendingChanges(let count):
                    pending = count
                    confirming = Confirmation(pending: count)
                case .notSignedIn: break
                }
            }
        }
    }
}
