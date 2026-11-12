import Foundation

/// A failed shared read or write, as the person needs to hear it (MAZ-75). Shared data is
/// online-only, so every failure says that nothing changed and what to do next, and the
/// caller keeps whatever the person typed.
///
/// Branches on the `APIError` case. For `409` and `400` the server's text is the explanation
/// (it names the restriction: "Paid expenses cannot be deleted."), and the few messages that
/// mean "your copy is stale" are recognized so the screen can offer a refresh instead.
public struct HouseholdFailure: Error, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// No connection: nothing was sent.
        case offline
        /// The server didn't answer.
        case unreachable
        /// Someone changed it after it was read (`Expense changed. Refresh and try again.`, a
        /// rule's revision, a monthly suggestion that no longer matches). Refresh, then review.
        case stale
        /// A rule the server enforces (a paid expense, an open month, unsettled balances, the
        /// creator's restrictions). The message says which.
        case restricted
        /// 404 for the household: the person left, was removed, or it was archived elsewhere.
        case membership
        /// 404 for an expense or rule: it was deleted elsewhere.
        case gone
        /// The invite code is wrong, expired or was replaced.
        case invalidInvite
        case rateLimited
        /// The session ended; sign in again.
        case signIn
        /// Refused before sending, or a 400 the person can fix (the message says what).
        case invalid
        case server
    }

    public var kind: Kind
    public var message: String

    public init(_ kind: Kind, _ message: String) {
        self.kind = kind
        self.message = message
    }

    /// Whether trying the same thing again later can work without changing it.
    public var canRetry: Bool { [.offline, .unreachable, .rateLimited, .server].contains(kind) }

    public static let offlineMessage = "You're offline. Shared households need a connection, so nothing was sent."

    public init(_ error: any Error) {
        guard let error = error as? APIError else {
            self.init(.server, "Something went wrong, so nothing was saved. Try again in a moment.")
            return
        }
        switch error {
        case .offline:
            self.init(.offline, Self.offlineMessage)
        case .timeout, .unreachable:
            self.init(.unreachable, "Penny can't reach the server, so nothing was sent. Try again when you're online.")
        case .unauthorized:
            self.init(.signIn, "Your session ended. Sign in again; nothing was changed.")
        case .rateLimited:
            self.init(.rateLimited, "Too many attempts. Wait a few minutes and try again.")
        case .notFound(let message):
            if message?.localizedCaseInsensitiveContains("household not found") == true || message == nil {
                self.init(
                    .membership,
                    "You're no longer a member of this household, or it was archived. Nothing was changed.")
            } else if message?.localizedCaseInsensitiveContains("month not found") == true {
                self.init(.membership, "You left this household before that month, so it isn't available.")
            } else {
                self.init(.gone, "This was deleted by someone else. Nothing was changed.")
            }
        case .conflict(let message):
            let text = message ?? "Someone changed this. Refresh and try again."
            self.init(Self.isStale(text) ? .stale : .restricted, text)
        case .badRequest(let message):
            let text = message ?? "Check what you entered and try again."
            if text.localizedCaseInsensitiveContains("invite code is invalid or expired") {
                self.init(.invalidInvite, text)
            } else {
                self.init(.invalid, text)
            }
        case .forbidden(let message):
            self.init(.restricted, message ?? "Only the household creator can do that.")
        case .invalidRequest:
            self.init(.invalid, "Check what you entered and try again.")
        case .payloadTooLarge:
            self.init(.invalid, "That's too much text to save. Shorten the note and try again.")
        case .unavailable, .server, .unexpectedStatus, .malformedResponse:
            self.init(.server, "The server had a problem, so nothing was saved. Try again in a moment.")
        }
    }

    /// The 409 messages that mean the person's copy is out of date (shared-expenses.md,
    /// settlement.md, shared-recurrence.md).
    static func isStale(_ message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("changed. refresh") || lower.contains("no longer the full suggested")
    }
}
