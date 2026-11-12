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

    /// The invite for a signed-in shell, once. Nil when none waits or it waits for a sign-in
    /// on another server.
    public func takeForShell() -> Invite? {
        guard let invite, !invite.waitsForSignIn else { return nil }
        self.invite = nil
        return invite
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
