import Foundation
public import PennyDomain

/// The keys and values the Expo app stored, as released (src/data/serverConnection.ts,
/// src/data/offlineLedger.ts, src/data/session.ts, src/shared/themeStorage.ts,
/// src/providers/AppLockProvider.tsx). Pure parsing; see docs/ios-expo-migration.md.
public enum ExpoLegacyFormat {
    /// AsyncStorage: `{url, legacyUrl, version?}` JSON, never scoped.
    public static let serverConnectionKey = "penny:server-connection"
    /// AsyncStorage: the signed-in email, scoped by server.
    public static let activeAccountKey = "penny:active-account"
    /// AsyncStorage: `penny:ledger:<lowercased email>`, scoped by server; `{base, local}` JSON.
    public static let ledgerPrefix = "penny:ledger:"
    /// SecureStore: the session token, scoped by server.
    public static let sessionKey = "penny-session"
    /// SecureStore: `light`, `dark`, `amoled` or `catppuccin`, never scoped.
    public static let themeKey = "penny-theme"
    /// SecureStore: `true` or `false`, never scoped.
    public static let lockKey = "penny-app-lock"

    /// The saved server choice (`ServerConfiguration`). `legacyUrl` is the server the build
    /// was made for; its data keeps the original unscoped keys.
    public struct ServerConnection: Codable, Equatable, Sendable {
        public var url: String
        public var legacyUrl: String
        public var version: String?

        public init(url: String, legacyUrl: String, version: String? = nil) {
            self.url = url
            self.legacyUrl = legacyUrl
            self.version = version
        }
    }

    /// The `{base, local}` record (`LocalLedger`): the last server ledger and this device's.
    public struct LocalLedger: Codable, Equatable, Sendable {
        public var base: WireLedger
        public var local: WireLedger

        public init(base: WireLedger, local: WireLedger) {
            self.base = base
            self.local = local
        }
    }

    public static func serverConnection(_ text: String) -> ServerConnection? {
        try? JSONDecoder().decode(ServerConnection.self, from: Data(text.utf8))
    }

    /// The ledger pair in domain form. Versions 1–3 are upgraded as the server does; an
    /// unknown version or damaged JSON is nil (the caller keeps the source).
    public static func ledger(_ text: String) -> (base: Ledger, local: Ledger)? {
        guard let record = try? JSONDecoder().decode(LocalLedger.self, from: Data(text.utf8)),
            let base = try? Ledger(wire: record.base), let local = try? Ledger(wire: record.local)
        else { return nil }
        return (base, local)
    }

    // MARK: Server namespaces

    /// `serverStorageKey`'s suffix: each code point of the server URL in lowercase hex,
    /// joined with dots (`https` → `68.74.74.70.73`).
    public static func scopeSuffix(_ server: String) -> String {
        server.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: ".")
    }

    /// The key the Expo app used for `key` on `server`: unscoped for the build's original
    /// server, `key.<suffix>` for any other.
    public static func storageKey(_ key: String, server: String, legacyServer: String) -> String {
        server == legacyServer ? key : "\(key).\(scopeSuffix(server))"
    }

    /// A stored key split into its name and server. `name` is everything before the server
    /// suffix (for ledgers, `penny:ledger:<email>`); `server` is nil for an unscoped key.
    /// Emails may contain dots, so the suffix is the leftmost one that decodes to an HTTP(S)
    /// URL and encodes back to exactly the same text.
    public static func split(_ key: String) -> (name: String, server: String?) {
        var index = key.startIndex
        while let dot = key[index...].firstIndex(of: ".") {
            let suffix = String(key[key.index(after: dot)...])
            if let server = decodeScope(suffix) { return (String(key[..<dot]), server) }
            index = key.index(after: dot)
        }
        return (key, nil)
    }

    static func decodeScope(_ suffix: String) -> String? {
        guard suffix.hasPrefix("68.74.74.70") else { return nil }
        var scalars = String.UnicodeScalarView()
        for token in suffix.split(separator: ".", omittingEmptySubsequences: false) {
            guard (1...6).contains(token.count), let value = UInt32(token, radix: 16),
                let scalar = Unicode.Scalar(value)
            else { return nil }
            scalars.append(scalar)
        }
        let server = String(scalars)
        guard scopeSuffix(server) == suffix, (try? ServerURL(server)) != nil else { return nil }
        return server
    }
}
