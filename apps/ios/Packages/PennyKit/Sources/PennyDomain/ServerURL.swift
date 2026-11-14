public import Foundation

/// A Penny server origin, normalized so that the same server typed in different ways compares
/// equal and keeps one storage namespace. MAZ-68 owns choosing and verifying a server; this type only
/// validates and normalizes one.
public struct ServerURL: Equatable, Hashable, Sendable, CustomStringConvertible {
    public let url: URL

    public enum Invalid: Error, Equatable, Sendable {
        /// Not an absolute URL, such as "penny.example.com".
        case notAbsolute
        /// Not HTTP(S), or has credentials, a query or a fragment.
        case unsupported
    }

    public init(_ input: String) throws(Invalid) {
        guard var components = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = components.scheme?.lowercased(),
            let host = components.host, !host.isEmpty
        else { throw .notAbsolute }
        guard scheme == "http" || scheme == "https",
            components.user == nil, components.password == nil,
            components.query == nil, components.fragment == nil
        else { throw .unsupported }

        components.scheme = scheme
        components.host = host.lowercased()
        if (scheme == "http" && components.port == 80) || (scheme == "https" && components.port == 443) {
            components.port = nil
        }
        while components.path.hasSuffix("/") { components.path.removeLast() }
        guard let url = components.url else { throw .notAbsolute }
        self.url = url
    }

    public var description: String { url.absoluteString }
}
