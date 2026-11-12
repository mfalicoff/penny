public import Observation

/// A `penny://join` link waiting to be used (MAZ-75). Invite links don't belong to an account
/// the way other links do (`DeepLinkInbox`): they name a server, and the person may need to sign
/// in, or sign out and connect to that server first. So the app keeps the latest one here, for
/// whichever screen can act on it:
///
/// - a signed-in shell on the link's server (or a link without one) opens the join sheet;
/// - a shell on another server opens the join sheet with the "another server" confirmation,
///   where the person can keep the invite for after signing out (`keepForSignIn`);
/// - the signed-out screens offer to connect to the link's server, without sending anything
///   but the server check, then to sign in; the invite opens after sign-in.
///
/// The values are kept as sent; `InviteLink` validates them where they are used.
@MainActor
@Observable
public final class InviteHandoff {
    public struct Invite: Equatable, Sendable {
        public var code: String?
        public var server: String?
        /// The person chose to sign out and join on the link's server: the current shell
        /// leaves it alone.
        public var waitsForSignIn: Bool
        /// The shell that is opening it (`takeForShell(by:)`); it stays here until the join
        /// sheet is on screen (`shown`), so an invite whose sheet never appeared isn't lost.
        public var openingBy: String?

        public init(code: String?, server: String?, waitsForSignIn: Bool, openingBy: String? = nil) {
            self.code = code
            self.server = server
            self.waitsForSignIn = waitsForSignIn
            self.openingBy = openingBy
        }
    }

    public private(set) var invite: Invite?
    /// Development builds accept plain HTTP to a loopback server in a link.
    public let allowsLoopbackHTTP: Bool

    public init(allowsLoopbackHTTP: Bool) {
        self.allowsLoopbackHTTP = allowsLoopbackHTTP
    }

    /// A newer link replaces an older one.
    public func receive(code: String?, server: String?) {
        invite = Invite(code: code, server: server, waitsForSignIn: false)
    }

    /// The invite for the signed-in shell `owner` (a stable key for it), once per shell. Nil
    /// when none waits, it waits for a sign-in on another server, or `owner` is already opening
    /// it. The invite is kept until its sheet is shown (`shown`), so if that shell goes away
    /// first (a sign-out, a crash of the presentation), the next shell can still open it.
    public func takeForShell(by owner: String) -> Invite? {
        guard let invite, !invite.waitsForSignIn, invite.openingBy != owner else { return nil }
        self.invite?.openingBy = owner
        return invite
    }

    /// The join sheet for this invite is on screen: it is used up.
    public func shown(code: String?, server: String?) {
        guard let invite, invite.openingBy != nil, invite.code == code, invite.server == server else { return }
        self.invite = nil
    }

    /// The person will sign out and join on the link's server.
    public func keepForSignIn(code: String?, server: String?) {
        invite = Invite(code: code, server: server, waitsForSignIn: true)
    }

    /// After signing in: the shell may take it now.
    public func signedIn() {
        if invite?.waitsForSignIn == true { invite?.waitsForSignIn = false }
    }

    public func clear() { invite = nil }
}
