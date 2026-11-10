import PennyData
import PennyDesign
import SwiftUI

/// The `sign-out` specimen as a reusable flow: a sign-out button that warns about unsynced
/// changes ("Sync, then sign out", "Sign out anyway", "Cancel"), and an actionable alert
/// when the server cannot be reached or the sync fails. Nothing is removed until the person
/// chooses to. MAZ-69's settings sheet places this button.
struct SignOutButton: View {
    let auth: AuthController

    @State private var pending = 0
    /// How many unsynced changes the person agreed to lose ("Sign out anyway"), 0 otherwise.
    @State private var discardConsent = 0
    @State private var confirming = false
    @State private var problem: Problem?

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
                confirming = true
            }
        } label: {
            HStack {
                Text(signingOut ? "Signing out…" : "Sign out")
                if signingOut {
                    Spacer()
                    ProgressView()
                }
            }
        }
        .disabled(signingOut || auth.state.account == nil)
        .accessibilityIdentifier("auth.signOut")
        .confirmationDialog(
            Self.title(pending: pending, host: host), isPresented: $confirming, titleVisibility: .visible
        ) {
            if pending > 0 {
                Button("Sync, then sign out") {
                    discardConsent = 0
                    run(.syncThenSignOut)
                }
                Button("Sign out anyway", role: .destructive) {
                    discardConsent = pending
                    run(.signOut(discard: true, evenIfUnreachable: false))
                }
            } else {
                Button("Sign out", role: .destructive) {
                    discardConsent = 0
                    run(.signOut(discard: false, evenIfUnreachable: false))
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(Self.message(pending: pending, host: host))
        }
        .alert(
            problem == .syncFailed ? "Couldn't sync your changes" : "Couldn't reach \(host)",
            isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } }), presenting: problem
        ) { problem in
            if problem == .unreachable {
                Button("Try again") { run(.retry(evenIfUnreachable: false)) }
                Button("Remove from this device", role: .destructive) { run(.retry(evenIfUnreachable: true)) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { problem in
            switch problem {
            case .syncFailed:
                Text("Nothing was removed. Check your connection and try again.")
            case .unreachable:
                Text(
                    "You're still signed in and nothing was removed. Try again when you're online, or remove this "
                        + "account from this device now; the server keeps that session until it expires.")
            }
        }
    }

    static func title(pending: Int, host: String) -> String {
        pending == 0
            ? "Sign out of \(host)?" : (pending == 1 ? "1 change hasn’t synced" : "\(pending) changes haven’t synced")
    }

    static func message(pending: Int, host: String) -> String {
        pending == 0
            ? "Your entries are removed from this device and stay safe on \(host)."
            : "Signing out removes your entries from this device. Synced entries stay safe on \(host); "
                + "\(pending == 1 ? "this one" : "these \(pending)") would be lost."
    }

    /// Whether a retry after "Couldn't reach" discards the changes pending now: only when the
    /// person agreed to lose at least that many. Changes made since are never discarded
    /// silently; sign-out then asks again with the new count.
    static func discardsOnRetry(pendingNow: Int, consented: Int) -> Bool {
        pendingNow > 0 && pendingNow <= consented
    }

    enum Action {
        case syncThenSignOut
        case signOut(discard: Bool, evenIfUnreachable: Bool)
        /// Again after the server was unreachable, with the pending count read at that moment.
        case retry(evenIfUnreachable: Bool)
    }

    private func run(_ action: Action) {
        Task {
            do throws(SignOutFailure) {
                switch action {
                case .syncThenSignOut:
                    try await auth.syncThenSignOut()
                case .signOut(let discard, let evenIfUnreachable):
                    try await auth.signOut(
                        discardingPendingChanges: discard, removeEvenIfUnreachable: evenIfUnreachable)
                case .retry(let evenIfUnreachable):
                    let pendingNow = await auth.pendingChangeCount()
                    try await auth.signOut(
                        discardingPendingChanges: Self.discardsOnRetry(
                            pendingNow: pendingNow, consented: discardConsent),
                        removeEvenIfUnreachable: evenIfUnreachable)
                }
            } catch {
                switch error {
                case .serverUnreachable: problem = .unreachable
                case .syncFailed: problem = .syncFailed
                case .pendingChanges(let count):
                    pending = count
                    confirming = true
                case .notSignedIn: break
                }
            }
        }
    }
}
