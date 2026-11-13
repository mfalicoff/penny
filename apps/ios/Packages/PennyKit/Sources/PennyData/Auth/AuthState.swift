public import PennyDomain

/// Where sign-in stands. Transitions (see docs/ios-authentication.md):
///
/// ```
/// restoring ──► signedIn(unverified) ──► signedIn(verified)
///     │                 │ 401                       │ 401 from its own scope
///     │                 ▼                           ▼
///     ├──────────► signedOut(reason) ◄──────── signingOut ◄── signedIn
///     │                 │  ▲                               (no pending changes,
///     ▼                 ▼  │ failure / cancel              or discarded)
/// keychainUnavailable  signingIn(method) ──► signedIn(verified)
/// ```
public enum AuthState: Equatable, Sendable {
    /// Reading the saved session at launch.
    case restoring
    /// The Keychain is locked (first launch after a restart, before unlock). Nothing is
    /// shown or deleted; `restore()` again once the device is unlocked.
    case keychainUnavailable
    case signedOut(SignedOutReason?)
    case signingIn(SignInMethod)
    case signedIn(SignedInAccount)
    /// Revoking the session; the account stays visible until it ends.
    case signingOut(SignedInAccount)

    public var account: SignedInAccount? {
        switch self {
        case .signedIn(let account), .signingOut(let account): account
        default: nil
        }
    }

    /// Whether the person may change the server: only while signed out.
    public var canChangeServer: Bool {
        if case .signedOut = self { return true }
        return false
    }
}

public enum SignedOutReason: Equatable, Sendable {
    /// The person signed out.
    case signedOut
    /// The server ended the session (expired or revoked). Local work for that account is
    /// kept, so signing in again as `email` picks it up.
    case sessionExpired(email: String)
}

public enum SignInMethod: Equatable, Sendable {
    case password
    case registration
    case singleSignOn
}

/// The signed-in account. `generation` changes with every sign-in, restore and sign-out, so
/// work started for one account can tell when it no longer applies.
public struct SignedInAccount: Equatable, Sendable {
    let session: ServerSession
    public let generation: Int
    /// False after a restore until `/api/auth/me` confirms the session (offline launches
    /// stay signed in with local data).
    public internal(set) var isVerified: Bool

    public var scope: AccountScope { session.scope }
    public var email: String { session.email }
    public var server: ServerURL { session.server }
}

/// Server single sign-on availability on the sign-in screen.
public enum SingleSignOnStatus: Equatable, Sendable {
    case unknown
    case checking
    case available(label: String)
    case unavailable
    /// The check failed (offline, server error). Offer a retry.
    case failed
}

/// A verified candidate server, from `checkServer`.
public struct ServerCheck: Equatable, Sendable {
    public let server: ServerURL
    public let version: String
    /// Nil when reading `GET /api/auth/oidc` failed.
    public let singleSignOn: Bool?
    public let singleSignOnLabel: String?

    public init(server: ServerURL, version: String, singleSignOn: Bool?, singleSignOnLabel: String?) {
        self.server = server
        self.version = version
        self.singleSignOn = singleSignOn
        self.singleSignOnLabel = singleSignOnLabel
    }

    public var isEncrypted: Bool { server.url.scheme == "https" }
}

/// A sign-in, registration or server failure, with a message to show as is. Branch on
/// `kind`; the message may come from the server.
public struct AuthFailure: Error, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case invalidInput
        case invalidCredentials
        case accountExists
        case registrationDisabled
        case rateLimited
        case offline
        case unreachable
        case notAPennyServer
        case singleSignOnUnavailable
        case singleSignOnExpired
        case singleSignOnRejected
        case callbackRejected
        case storage
        case server
        /// Another sign-in is in progress, or the person is already signed in.
        case busy
        case noServer
        /// The server changed while the request was in flight; its answer was dropped.
        case superseded
    }

    public let kind: Kind
    public let message: String

    public init(_ kind: Kind, _ message: String) {
        self.kind = kind
        self.message = message
    }
}

public enum SignInOutcome: Equatable, Sendable {
    case signedIn
    /// The person closed the sign-in sheet or declined at the provider. Not an error.
    case cancelled
}

public enum SignOutFailure: Error, Equatable, Sendable {
    /// Changes have not synced. Offer "Sync, then sign out" and "Sign out anyway".
    case pendingChanges(count: Int)
    /// The server could not be reached to revoke the session. Nothing changed; offer a
    /// retry or `signOut(removeEvenIfUnreachable: true)`.
    case serverUnreachable
    /// "Sync, then sign out" could not send everything. Nothing was removed.
    case syncFailed
    case notSignedIn
}
