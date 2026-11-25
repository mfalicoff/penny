public import Foundation
public import PennyDomain
import Synchronization

/// The server this device uses, as the person last chose and verified it. Not a secret:
/// it lives in the app's preferences, while the session token lives in the Keychain.
public struct SavedServer: Codable, Equatable, Sendable {
    public var server: ServerURL
    /// The version `/api/info` reported when the server was verified, if it was.
    public var version: String?
    /// The privacy policy `/api/info` last published (MAZ-169), kept so Settings can link it
    /// offline. Nil when the server publishes none.
    public var privacyPolicy: URL?
    /// Whether `/api/info` last said the server sends email (MAZ-124): Forgot password on sign-in
    /// and Invite by email. False until a server says so, and on servers older than the field.
    public var emailEnabled: Bool
    /// Whether `/api/info` last said the server takes the app's crash and performance reports
    /// (`telemetry.native`, MAZ-129). False until a server says so.
    public var nativeTelemetry: Bool

    public init(
        server: ServerURL, version: String? = nil, privacyPolicy: URL? = nil, emailEnabled: Bool = false,
        nativeTelemetry: Bool = false
    ) {
        self.server = server
        self.version = version
        self.privacyPolicy = privacyPolicy
        self.emailEnabled = emailEnabled
        self.nativeTelemetry = nativeTelemetry
    }

    private enum CodingKeys: String, CodingKey { case url, version, privacyPolicyUrl, emailEnabled, nativeTelemetry }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let text = try container.decode(String.self, forKey: .url)
        do { server = try ServerURL(text) } catch {
            throw DecodingError.dataCorruptedError(forKey: .url, in: container, debugDescription: "Invalid server URL")
        }
        version = try container.decodeIfPresent(String.self, forKey: .version)
        privacyPolicy = PrivacyPolicy.url(try? container.decodeIfPresent(String.self, forKey: .privacyPolicyUrl))
        emailEnabled = (try? container.decodeIfPresent(Bool.self, forKey: .emailEnabled)) == true
        nativeTelemetry = (try? container.decodeIfPresent(Bool.self, forKey: .nativeTelemetry)) == true
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(server.url.absoluteString, forKey: .url)
        try container.encodeIfPresent(version, forKey: .version)
        try container.encodeIfPresent(privacyPolicy?.absoluteString, forKey: .privacyPolicyUrl)
        if emailEnabled { try container.encode(true, forKey: .emailEnabled) }
        if nativeTelemetry { try container.encode(true, forKey: .nativeTelemetry) }
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
    /// An account whose entries a sign-out could not remove (`AuthController.unremovedLocalData`),
    /// kept across launches so the signed-out screen can still offer to remove them.
    func unremovedLocalData() -> AccountScope?
    func setUnremovedLocalData(_ scope: AccountScope?)
}

/// How `unremovedLocalData` is stored.
struct StoredScope: Codable {
    var server: String
    var email: String

    init(_ scope: AccountScope) {
        server = scope.server.description
        email = scope.email
    }

    var scope: AccountScope? { (try? ServerURL(server)).map { AccountScope(server: $0, email: email) } }
}

/// `AuthPreferences` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsAuthPreferences: AuthPreferences {
    static let serverKey = "penny.auth.server"
    static let launchedKey = "penny.auth.launched"
    static let unremovedKey = "penny.auth.unremovedLocalData"

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

    public func unremovedLocalData() -> AccountScope? {
        defaults.data(forKey: Self.unremovedKey).flatMap { try? JSONDecoder().decode(StoredScope.self, from: $0) }?
            .scope
    }

    public func setUnremovedLocalData(_ scope: AccountScope?) {
        guard let scope, let data = try? JSONEncoder().encode(StoredScope(scope)) else {
            defaults.removeObject(forKey: Self.unremovedKey)
            return
        }
        defaults.set(data, forKey: Self.unremovedKey)
    }
}

/// Preferences in memory, for previews and tests.
public final class EphemeralAuthPreferences: AuthPreferences {
    private struct Values {
        var server: SavedServer?
        var launched: Bool
        var unremoved: AccountScope?
    }
    private let values: Mutex<Values>

    public init(server: SavedServer? = nil, launchedBefore: Bool = true) {
        values = Mutex(Values(server: server, launched: launchedBefore, unremoved: nil))
    }

    public func savedServer() -> SavedServer? { values.withLock { $0.server } }
    public func setSavedServer(_ server: SavedServer) throws { values.withLock { $0.server = server } }
    public var hasLaunchedBefore: Bool { values.withLock { $0.launched } }
    public func markLaunched() { values.withLock { $0.launched = true } }
    public func unremovedLocalData() -> AccountScope? { values.withLock { $0.unremoved } }
    public func setUnremovedLocalData(_ scope: AccountScope?) { values.withLock { $0.unremoved = scope } }
}
