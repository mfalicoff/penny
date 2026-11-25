public import Foundation
public import PennyDomain

/// Where sign-in stands. Transitions (see docs/ios/authentication.md):
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
    /// MAZ-124: a reset code set a new password, and the server signed every device out. Sign-in
    /// says so.
    case passwordReset
    /// MAZ-152: the person deleted their account. The server signed every device out and this
    /// device removed the account's local data. Sign-in says so.
    case accountDeleted
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

    /// MAZ-169: the server's privacy policy, when it publishes one.
    public let privacyPolicy: URL?
    /// MAZ-124: whether the server sends email.
    public let emailEnabled: Bool

    public init(
        server: ServerURL, version: String, singleSignOn: Bool?, singleSignOnLabel: String?,
        privacyPolicy: URL? = nil, emailEnabled: Bool = false
    ) {
        self.emailEnabled = emailEnabled
        self.server = server
        self.version = version
        self.singleSignOn = singleSignOn
        self.singleSignOnLabel = singleSignOnLabel
        self.privacyPolicy = privacyPolicy
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
        /// MAZ-124: a password reset code that is malformed, used, replaced or expired.
        case invalidCode
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

/// How Change email ended (MAZ-172).
public enum EmailChangeOutcome: Equatable, Sendable {
    /// The account now signs in with the profile's email, unverified.
    case changed(WireProfile)
    /// The address is invalid or another account uses it: show it under Email.
    case invalidEmail(String)
    /// The password is missing or wrong: clear and refocus Password.
    case wrongPassword(String)
    case failed(String)
}

/// Why Delete account didn't go ahead (MAZ-152). Nothing was deleted, and the session stays
/// unless `kind` is `sessionEnded`.
public struct AccountDeletionFailure: Error, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// A wrong or missing password (400): clear and refocus the password.
        case wrongPassword
        /// A household rule blocks leaving (409), such as a balance to settle. `message` names it.
        case blocked
        /// The server couldn't be reached, or failed. Try again.
        case failed
        /// The session had already ended (401): sign-in shows next.
        case sessionEnded
        case notSignedIn
    }

    public let kind: Kind
    /// What the sheet shows, the server's own words where it sent some.
    public let message: String

    public init(_ kind: Kind, _ message: String) {
        self.kind = kind
        self.message = message
    }

    public static let wrongPasswordMessage = "Your password is incorrect."
    public static let enterPasswordMessage = "Enter your password to delete your account."
    public static let offlineMessage = "Penny can't reach the server. Check your connection, then try again."
    public static let failedMessage = "Your account wasn't deleted. Try again."

    /// The failure for an error from `POST /api/account/delete`.
    public init(_ error: any Error) {
        guard let error = error as? APIError else {
            self.init(.failed, Self.failedMessage)
            return
        }
        switch error {
        case .badRequest(let message): self.init(.wrongPassword, message ?? Self.wrongPasswordMessage)
        case .conflict(let message): self.init(.blocked, message ?? Self.failedMessage)
        case .unauthorized: self.init(.sessionEnded, "Your session ended. Sign in again.")
        case .offline, .timeout, .unreachable: self.init(.failed, Self.offlineMessage)
        case .rateLimited(let after):
            let minutes = after.map { max(1, Int(($0 / 60).rounded(.up))) } ?? 15
            self.init(.failed, "Too many attempts. Please try again in \(minutes) minute\(minutes == 1 ? "" : "s").")
        case .forbidden(let message), .server(_, let message), .unavailable(_, let message):
            self.init(.failed, message ?? Self.failedMessage)
        default: self.init(.failed, Self.failedMessage)
        }
    }
}
