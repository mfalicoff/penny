public import Foundation
public import PennyDomain
import Security
import Synchronization

/// Where signed-in sessions are kept between launches: one per server, never more. The
/// production store is `KeychainSessionStore`; tests and previews use `EphemeralSessionStore`.
public protocol SessionStore: Sendable {
    /// The session saved for `server`, or nil when there is none. A damaged item is deleted
    /// and reported as nil, because nothing in it can be recovered.
    func load(server: ServerURL) throws(SessionStoreError) -> ServerSession?
    /// Saves `session` for its server, replacing any earlier session for that server.
    func save(_ session: ServerSession) throws(SessionStoreError)
    func delete(server: ServerURL) throws(SessionStoreError)
    /// Deletes every saved session (fresh install, see `AuthController.restore`).
    func deleteAll() throws(SessionStoreError)
}

public enum SessionStoreError: Error, Equatable, Sendable {
    /// The Keychain cannot be read now: the device has not been unlocked since it started.
    /// Retry after unlock; never treat this as "signed out".
    case unavailable
    /// Any other Keychain status. Carries the status code only, never item data.
    case failed(OSStatus)
}

/// The Keychain adapter (MAZ-68). Each server's session is one generic-password item:
///
/// - service `com.mfalicoff.penny.session`, account = the normalized server URL;
/// - value: a small JSON record `{version, server, email, token}`;
/// - accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable by
///   background work after the first unlock, never synced to iCloud Keychain and never
///   restored from a backup onto another device;
/// - the data protection keychain on every platform, in the app's default access group
///   (the widget extension never needs the token).
///
/// See docs/ios-authentication.md.
public struct KeychainSessionStore: SessionStore {
    public static let service = "\(AppIdentity.bundleIdentifier).session"
    static let recordVersion = 1

    private let backend: any KeychainBackend

    public init(backend: any KeychainBackend = SystemKeychain()) {
        self.backend = backend
    }

    struct Record: Codable, Equatable {
        var version: Int
        var server: String
        var email: String
        var token: String
    }

    func itemQuery(_ server: ServerURL) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: server.url.absoluteString,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public func load(server: ServerURL) throws(SessionStoreError) -> ServerSession? {
        var query = itemQuery(server)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, data) = backend.copyData(query)
        switch status {
        case errSecSuccess: break
        case errSecItemNotFound: return nil
        default: throw Self.error(status)
        }
        guard let data, let record = try? JSONDecoder().decode(Record.self, from: data),
            record.version == Self.recordVersion, record.server == server.url.absoluteString,
            let session = try? ServerSession(server: server, email: record.email, token: record.token)
        else {
            try delete(server: server)
            return nil
        }
        return session
    }

    public func save(_ session: ServerSession) throws(SessionStoreError) {
        let record = Record(
            version: Self.recordVersion, server: session.server.url.absoluteString, email: session.email,
            token: session.tokenForStorage)
        guard let data = try? JSONEncoder().encode(record) else { throw .failed(errSecParam) }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let query = itemQuery(session.server)
        let updated = backend.update(query, attributes)
        switch updated {
        case errSecSuccess: return
        case errSecItemNotFound: break
        default: throw Self.error(updated)
        }
        var item = query.merging(attributes) { _, new in new }
        item[kSecAttrSynchronizable as String] = false
        item[kSecAttrLabel as String] = "Penny sign-in"
        let added = backend.add(item)
        guard added == errSecSuccess else { throw Self.error(added) }
    }

    public func delete(server: ServerURL) throws(SessionStoreError) {
        let status = backend.delete(itemQuery(server))
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.error(status) }
    }

    public func deleteAll() throws(SessionStoreError) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecUseDataProtectionKeychain as String: true,
        ]
        let status = backend.delete(query)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.error(status) }
    }

    static func error(_ status: OSStatus) -> SessionStoreError {
        status == errSecInteractionNotAllowed ? .unavailable : .failed(status)
    }
}

/// The four Keychain calls the store needs, so its query building and status handling can
/// be tested without a real Keychain (which a host test process cannot use).
public protocol KeychainBackend: Sendable {
    func copyData(_ query: [String: Any]) -> (OSStatus, Data?)
    func add(_ attributes: [String: Any]) -> OSStatus
    func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus
    func delete(_ query: [String: Any]) -> OSStatus
}

/// `SecItem*` on the real Keychain.
public struct SystemKeychain: KeychainBackend {
    public init() {}

    public func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? Data)
    }

    public func add(_ attributes: [String: Any]) -> OSStatus {
        SecItemAdd(attributes as CFDictionary, nil)
    }

    public func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    public func delete(_ query: [String: Any]) -> OSStatus {
        SecItemDelete(query as CFDictionary)
    }
}

/// Keeps sessions in memory only, for previews and tests. Nothing survives the process.
public final class EphemeralSessionStore: SessionStore {
    private let sessions = Mutex<[ServerURL: ServerSession]>([:])

    public init(_ sessions: [ServerSession] = []) {
        self.sessions.withLock { stored in for session in sessions { stored[session.server] = session } }
    }

    public func load(server: ServerURL) throws(SessionStoreError) -> ServerSession? {
        sessions.withLock { $0[server] }
    }

    public func save(_ session: ServerSession) throws(SessionStoreError) {
        sessions.withLock { $0[session.server] = session }
    }

    public func delete(server: ServerURL) throws(SessionStoreError) {
        sessions.withLock { $0[server] = nil }
    }

    public func deleteAll() throws(SessionStoreError) {
        sessions.withLock { $0.removeAll() }
    }
}
