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

/// The platform's own sign-in (Sign in with Apple) for a provider whose `native` is true
/// (MAZ-170). PennyUI implements it with `ASAuthorizationAppleIDProvider`; tests substitute a fake.
public protocol NativeSignInAuthenticator: Sendable {
    /// Asks the platform for an ID token carrying `nonce` unchanged.
    /// - Throws: `CancellationError` when the person closes the sheet; any other error when
    ///   the platform could not sign in.
    func authorize(nonce: String) async throws -> NativeSignInCredential
}

/// What the platform's sign-in returned. Apple gives the name only the first time someone
/// signs in to the app.
public struct NativeSignInCredential: Equatable, Sendable {
    public let idToken: String
    public let givenName: String?
    public let familyName: String?

    public init(idToken: String, givenName: String? = nil, familyName: String? = nil) {
        self.idToken = idToken
        self.givenName = givenName
        self.familyName = familyName
    }
}

/// A sign-in provider the server lists in `GET /api/auth/oidc` (MAZ-170), in its order. The
/// sign-in screens show one button per provider, and none when the server lists none.
public struct SignInProvider: Equatable, Sendable, Identifiable {
    /// The mark on the provider's button: Apple's and Google's own, or the generic key.
    public enum Mark: Equatable, Sendable {
        case apple
        case google
        case other
    }

    public let id: String
    public let label: String
    public let mark: Mark
    /// The app may sign in with the platform's own sign-in for this provider.
    public let native: Bool
    /// False for the single provider of a server from before MAZ-170, which takes no `provider`
    /// when a sign-in starts.
    let sendsID: Bool

    public init(id: String, label: String, icon: String, native: Bool = false) {
        self.init(id: id, label: label, mark: Self.mark(icon), native: native, sendsID: true)
    }

    init(id: String, label: String, mark: Mark, native: Bool, sendsID: Bool) {
        self.id = id
        self.label = label
        self.mark = mark
        self.native = native
        self.sendsID = sendsID
    }

    /// Apple and Google follow their own button rules ("Sign in with Google"); any other
    /// provider is the server's single sign-on.
    public var isBrand: Bool { mark != .other }

    /// `google` and `apple` get their marks; any other icon name the generic one.
    public static func mark(_ icon: String?) -> Mark {
        switch icon {
        case "apple": .apple
        case "google": .google
        default: .other
        }
    }

    /// The providers to show from `GET /api/auth/oidc`: valid entries in order, each id once.
    /// A server from before MAZ-170 sends no list; its one provider (when enabled) becomes
    /// `sso`, started without an id.
    static func list(from config: WireOidcConfig) -> [SignInProvider] {
        guard let providers = config.providers else {
            guard config.enabled else { return [] }
            return [
                SignInProvider(id: "sso", label: label(config.label), mark: .other, native: false, sendsID: false)
            ]
        }
        var seen = Set<String>()
        return providers.compactMap { provider in
            let label = provider.label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard isValidID(provider.id), !label.isEmpty, label.utf16.count <= 60,
                seen.insert(provider.id).inserted
            else { return nil }
            return SignInProvider(id: provider.id, label: label, icon: provider.icon, native: provider.native)
        }
    }

    /// `^[a-z0-9][a-z0-9_-]{0,31}$`, as the API defines a provider id.
    static func isValidID(_ id: String) -> Bool {
        let scalars = Array(id.unicodeScalars)
        guard (1...32).contains(scalars.count) else { return false }
        func allowed(_ scalar: Unicode.Scalar, first: Bool) -> Bool {
            ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar)
                || (!first && (scalar == "_" || scalar == "-"))
        }
        return scalars.enumerated().allSatisfy { allowed($1, first: $0 == 0) }
    }

    static func label(_ label: String?) -> String {
        let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "single sign-on" : trimmed
    }
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

    /// True when the provider reported that the person declined: `error=access_denied`, or
    /// Apple's `user_cancelled_authorize` (MAZ-170), passed on by the server's callback relay.
    static func isDeclined(_ url: URL) -> Bool {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains {
            $0.name == "error" && ($0.value == "access_denied" || $0.value == "user_cancelled_authorize")
        } ?? false
    }
}

/// One single sign-on attempt kept only in memory: the transaction is a secret between
/// this device and the server, and it is used at most once.
struct PendingSingleSignOn: Equatable {
    let id: Int
    let server: ServerURL
    let transaction: String
    /// When the attempt ends on the device clock (request time + the server-stated lifetime).
    /// Nil when the server sent no `Date`: its own check on complete then decides.
    let deadline: Date?
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
