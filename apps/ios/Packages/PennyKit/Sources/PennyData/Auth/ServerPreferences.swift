import Foundation
public import PennyDomain
import Synchronization

/// The server this device uses, as the person last chose and verified it. Not a secret:
/// it lives in the app's preferences, while the session token lives in the Keychain.
public struct SavedServer: Codable, Equatable, Sendable {
    public var server: ServerURL
    /// The version `/api/info` reported when the server was verified, if it was.
    public var version: String?

    public init(server: ServerURL, version: String? = nil) {
        self.server = server
        self.version = version
    }

    private enum CodingKeys: String, CodingKey { case url, version }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let text = try container.decode(String.self, forKey: .url)
        do { server = try ServerURL(text) } catch {
            throw DecodingError.dataCorruptedError(forKey: .url, in: container, debugDescription: "Invalid server URL")
        }
        version = try container.decodeIfPresent(String.self, forKey: .version)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(server.url.absoluteString, forKey: .url)
        try container.encodeIfPresent(version, forKey: .version)
    }
}

/// Non-secret sign-in preferences: the chosen server and the install marker that lets a
/// reinstall drop Keychain items a deleted app left behind.
public protocol AuthPreferences: Sendable {
    func savedServer() -> SavedServer?
    func setSavedServer(_ server: SavedServer) throws
    /// False on the first launch after install. Keychain items outlive app deletion, so the
    /// first launch deletes them instead of restoring a session nobody expects.
    var hasLaunchedBefore: Bool { get }
    func markLaunched()
}

/// `AuthPreferences` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsAuthPreferences: AuthPreferences {
    static let serverKey = "penny.auth.server"
    static let launchedKey = "penny.auth.launched"

    private let suiteName: String?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    /// UserDefaults is not Sendable, so it is looked up on use.
    private var defaults: UserDefaults {
        suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    public func savedServer() -> SavedServer? {
        defaults.data(forKey: Self.serverKey).flatMap { try? JSONDecoder().decode(SavedServer.self, from: $0) }
    }

    public func setSavedServer(_ server: SavedServer) throws {
        defaults.set(try JSONEncoder().encode(server), forKey: Self.serverKey)
    }

    public var hasLaunchedBefore: Bool { defaults.bool(forKey: Self.launchedKey) }

    public func markLaunched() { defaults.set(true, forKey: Self.launchedKey) }
}

/// Preferences in memory, for previews and tests.
public final class EphemeralAuthPreferences: AuthPreferences {
    private struct Values {
        var server: SavedServer?
        var launched: Bool
    }
    private let values: Mutex<Values>

    public init(server: SavedServer? = nil, launchedBefore: Bool = true) {
        values = Mutex(Values(server: server, launched: launchedBefore))
    }

    public func savedServer() -> SavedServer? { values.withLock { $0.server } }
    public func setSavedServer(_ server: SavedServer) throws { values.withLock { $0.server = server } }
    public var hasLaunchedBefore: Bool { values.withLock { $0.launched } }
    public func markLaunched() { values.withLock { $0.launched = true } }
}
