public import PennyDomain

/// A bearer token bound to the one server that issued it. `APIClient` sends it only to
/// that server, so a token can never reach another host through a configuration mistake
/// or a redirect. It never prints its value.
public struct ServerSession: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let server: ServerURL
    public let email: String
    let token: String

    /// Fails unless the token is the 64 lowercase hex characters the contract defines.
    public init(server: ServerURL, email: String, token: String) throws(APIError) {
        guard token.utf8.count == 64, token.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) })
        else { throw .invalidRequest(.invalidToken) }
        self.server = server
        self.email = email
        self.token = token
    }

    /// The token, for the Keychain (MAZ-68). Call sites that log or display must not use it.
    public var tokenForStorage: String { token }

    public var description: String { "ServerSession(\(server), \(email), token: <redacted>)" }
    public var debugDescription: String { description }

    /// The partition for anything cached or requested on behalf of this account: results
    /// and requests of one server and account never mix with another's.
    public var scope: AccountScope { AccountScope(server: server, email: email.lowercased()) }
}

public struct AccountScope: Hashable, Sendable {
    public let server: ServerURL
    public let email: String

    public init(server: ServerURL, email: String) {
        self.server = server
        self.email = email
    }
}
