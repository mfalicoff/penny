public import Foundation
public import PennyDomain

/// Presents the provider's page in the system authentication session and returns the
/// callback URL it ends on. PennyUI implements it with `ASWebAuthenticationSession`
/// (SwiftUI's `WebAuthenticationSession`); tests substitute a fake.
public protocol WebAuthenticator: Sendable {
    /// - Throws: `CancellationError` when the person closes the sheet; any other error when
    ///   the session could not start.
    func authenticate(at url: URL, callbackScheme: String) async throws -> URL
}

/// The native OIDC redirect. The server must list it exactly in `Oidc__RedirectUris`
/// (and the provider must accept it) for single sign-on to work in the app.
public enum SingleSignOnRedirect {
    public static let uri = "\(DeepLink.scheme)://auth/callback"
    public static let scheme = DeepLink.scheme

    /// Checks a callback before it is sent to the server: the `penny://auth/callback`
    /// redirect, with no fragment and exactly one `state`. The server repeats every check
    /// and also verifies state, code and issuer; this only refuses obvious garbage early.
    static func isWellFormed(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == scheme, components.host?.lowercased() == "auth",
            components.path == "/callback", components.fragment == nil, components.user == nil
        else { return false }
        let items = components.queryItems ?? []
        return items.filter { $0.name == "state" }.count == 1
    }

    /// True when the provider reported that the person declined (`error=access_denied`).
    static func isDeclined(_ url: URL) -> Bool {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains {
            $0.name == "error" && $0.value == "access_denied"
        } ?? false
    }
}

/// One single sign-on attempt kept only in memory: the transaction is a secret between
/// this device and the server, and it is used at most once.
struct PendingSingleSignOn: Equatable {
    let id: Int
    let server: ServerURL
    let transaction: String
    let expiry: Date
}

/// Remembers callbacks already sent, so the same callback URL is never redeemed twice even
/// if a provider or the system delivers it again. The server also consumes the attempt
/// before anything else, so a replay can never create a second session.
struct CallbackReplayGuard {
    private var seen: [String] = []
    private let limit = 32

    /// Records `url`; false when it was already used.
    mutating func admit(_ url: URL) -> Bool {
        let key = url.absoluteString
        guard !seen.contains(key) else { return false }
        seen.append(key)
        if seen.count > limit { seen.removeFirst(seen.count - limit) }
        return true
    }
}
