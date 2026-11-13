public import Foundation

/// A household invite code (MAZ-56): 10 hexadecimal characters, valid for 10 minutes and for
/// any number of people until it expires or is replaced. People read codes aloud and type them
/// with spaces or dashes, so `init?(typed:)` drops the separators the legacy and web forms
/// drop (`normalizeInviteCode`) and upper-cases the rest; the server accepts either case.
public struct InviteCode: Hashable, Sendable, CustomStringConvertible {
    public static let length = 10
    /// The lifetime the server gives every new code.
    public static let lifetime: TimeInterval = 10 * 60

    /// Upper-case, exactly 10 hex characters.
    public let value: String

    public init?(typed: String) {
        let separators: Set<Character> = [" ", "\t", "\n", "-", ".", "·", "\u{2011}", "\u{2013}", "\u{00A0}"]
        let cleaned = String(typed.filter { !separators.contains($0) }).uppercased()
        guard cleaned.count == Self.length, cleaned.unicodeScalars.allSatisfy(Self.isHex) else { return nil }
        value = cleaned
    }

    private static func isHex(_ scalar: Unicode.Scalar) -> Bool {
        ("0"..."9").contains(scalar) || ("A"..."F").contains(scalar)
    }

    /// Two groups of five ("4F2A9 C01BE"), easier to read aloud. Typing it back works.
    public var grouped: String { "\(value.prefix(5)) \(value.suffix(5))" }

    /// Each character spelled out for VoiceOver ("4, F, 2, A, 9, C, 0, 1, B, E").
    public var spoken: String { value.map(String.init).joined(separator: ", ") }

    public var description: String { value }
}

/// A household invite as a link: `penny://join?code=<CODE>&server=<server URL>`. The QR code
/// on the invite screen encodes it, so scanning it with the in-app scanner or the iOS Camera
/// app opens Penny on the join screen with the code filled in.
///
/// The server travels with the code because codes only exist on one server. Rules (MAZ-75):
/// - The server must be HTTPS. Plain HTTP is accepted only for a loopback host (localhost,
///   127.0.0.1, ::1) and only when `allowsLoopbackHTTP` (development builds), so a link can't
///   steer anyone to an unencrypted server.
/// - A link without a server means "the server you use" (older links, typed codes).
/// - A malformed link (no code, a bad code, a server that isn't a plain HTTP(S) origin) is
///   rejected with a reason, never followed.
/// - Naming another server than the signed-in one is allowed, but the app must ask before
///   connecting there and never sends the current session to it (`InviteLink.Target`).
public struct InviteLink: Equatable, Sendable {
    public let code: InviteCode
    /// Nil when the link didn't name one.
    public let server: ServerURL?

    public enum Invalid: Error, Equatable, Sendable {
        /// No code, or not 10 hex characters.
        case invalidCode
        /// Not an absolute HTTP(S) URL, or has credentials, a query or a fragment.
        case invalidServer
        /// HTTP to anything but a loopback host in development.
        case insecureServer
    }

    public init(code: InviteCode, server: ServerURL?) {
        self.code = code
        self.server = server
    }

    /// Validates the values of a `penny://join` link (`DeepLink.join`).
    public init(code: String?, server: String?, allowsLoopbackHTTP: Bool) throws(Invalid) {
        guard let code, let parsed = InviteCode(typed: code) else { throw .invalidCode }
        self.code = parsed
        guard let server else {
            self.server = nil
            return
        }
        let url: ServerURL
        do { url = try ServerURL(server) } catch { throw .invalidServer }
        guard Self.isAllowed(url, allowsLoopbackHTTP: allowsLoopbackHTTP) else { throw .insecureServer }
        self.server = url
    }

    /// Reads what a scanner or the clipboard produced: a `penny://join` link or a bare code.
    public init(scanned text: String, allowsLoopbackHTTP: Bool) throws(Invalid) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), url.scheme != nil {
            guard let link = DeepLink(url: url), case .join(let code, let server) = link else { throw .invalidCode }
            try self.init(code: code, server: server, allowsLoopbackHTTP: allowsLoopbackHTTP)
            return
        }
        guard let code = InviteCode(typed: trimmed) else { throw .invalidCode }
        self.init(code: code, server: nil)
    }

    /// Whether a server may appear in an invite: HTTPS, or HTTP to loopback in development.
    public static func isAllowed(_ server: ServerURL, allowsLoopbackHTTP: Bool) -> Bool {
        switch server.url.scheme {
        case "https": true
        case "http": allowsLoopbackHTTP && isLoopback(server)
        default: false
        }
    }

    public static func isLoopback(_ server: ServerURL) -> Bool {
        let host = (server.url.host ?? "").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return host == "localhost" || host == "::1" || isLoopbackIPv4(host)
    }

    /// A dotted-quad IPv4 literal in 127.0.0.0/8 ("127.0.0.1", "127.1.2.3"), not a host name
    /// that merely starts with "127." ("127.evil.example").
    static func isLoopbackIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[0] == "127" else { return false }
        return parts.allSatisfy { part in
            (1...3).contains(part.count) && part.allSatisfy { $0.isASCII && $0.isNumber } && (Int(part) ?? 256) <= 255
        }
    }

    /// The link the QR code encodes. Values are percent-encoded so the server URL (with its
    /// `:` and `/`) survives every QR reader and the Camera app.
    public var url: URL {
        var components = URLComponents()
        components.scheme = DeepLink.scheme
        components.host = "join"
        let strict = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var query = "code=\(code.value)"
        if let server, let encoded = server.description.addingPercentEncoding(withAllowedCharacters: strict) {
            query += "&server=\(encoded)"
        }
        components.percentEncodedQuery = query
        return components.url ?? URL(fileURLWithPath: "/")
    }

    /// Where this invite should be used, given the server the person is signed in to (nil when
    /// signed out with no server chosen).
    public enum Target: Equatable, Sendable {
        /// The current server (or the link didn't name one): join there with the code.
        case current
        /// Another server. Ask first; joining there needs signing in on that server.
        case other(ServerURL)
    }

    public func target(current: ServerURL?) -> Target {
        guard let server, server != current else { return .current }
        return .other(server)
    }
}
