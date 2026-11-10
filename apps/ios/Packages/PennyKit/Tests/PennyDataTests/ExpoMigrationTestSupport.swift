import Foundation
import PennyData
import PennyDomain
import Security
import Synchronization

/// The Keychain as expo-secure-store uses it: generic passwords keyed by service and the
/// account's raw bytes (the key's UTF-8). `forcedStatus` simulates a locked device.
final class ExpoKeychain: KeychainBackend {
    private let items = Mutex<[String: Data]>([:])
    let forcedStatus = Mutex<OSStatus?>(nil)

    private static func id(_ query: [String: Any]) -> String? {
        guard (query[kSecClass as String] as? String) == (kSecClassGenericPassword as String),
            let service = query[kSecAttrService as String] as? String,
            let account = query[kSecAttrAccount as String] as? Data,
            query[kSecAttrGeneric as String] as? Data == account
        else { return nil }
        return "\(service)|\(account.base64EncodedString())"
    }

    func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
        if let forced = forcedStatus.withLock({ $0 }) { return (forced, nil) }
        guard let id = Self.id(query) else { return (errSecParam, nil) }
        guard let data = items.withLock({ $0[id] }) else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, data)
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard let id = Self.id(attributes), let data = attributes[kSecValueData as String] as? Data else {
            return errSecParam
        }
        return items.withLock { items in
            guard items[id] == nil else { return errSecDuplicateItem }
            items[id] = data
            return errSecSuccess
        }
    }

    func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard let id = Self.id(query), let data = attributes[kSecValueData as String] as? Data else { return errSecParam }
        return items.withLock { items in
            guard items[id] != nil else { return errSecItemNotFound }
            items[id] = data
            return errSecSuccess
        }
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard let id = Self.id(query) else { return errSecParam }
        return items.withLock { $0.removeValue(forKey: id) == nil ? errSecItemNotFound : errSecSuccess }
    }

    /// The item as expo-secure-store would read it.
    func value(_ key: String, service: String = ExpoSecureStore.service) -> String? {
        let id = "\(service)|\(Data(key.utf8).base64EncodedString())"
        return items.withLock { $0[id] }.flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Plants an item the way SecureStore before SDK 50 did (service `app`).
    func putLegacy(_ value: String, forKey key: String) {
        items.withLock { $0["\(ExpoSecureStore.legacyService)|\(Data(key.utf8).base64EncodedString())"] = Data(value.utf8) }
    }

    var count: Int { items.withLock { $0.count } }
}

final class ExpoClock: Sendable {
    private let value = Mutex(Date(timeIntervalSince1970: 1_799_990_000))
    var now: Date { value.withLock { $0 } }
    func advance(_ seconds: TimeInterval) { value.withLock { $0 += seconds } }
}

/// A device that had the Expo build installed: its AsyncStorage and SecureStore in a
/// temporary container, and the native stores the importer writes to (in memory, except the
/// ledgers and the journal, which use the real durable files). Fixture data only.
final class ExpoInstall {
    static let legacyServer = "https://penny.example.test"
    static let otherServer = "https://other.example.test:8443"
    /// A second fixture token (64 lowercase hex characters).
    static let otherToken = String(repeating: "cd", count: 32)

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("penny-expo-\(UUID().uuidString)")
    let keychain = ExpoKeychain()
    let sessions = EphemeralSessionStore()
    let auth = EphemeralAuthPreferences(server: nil, launchedBefore: false)
    let device = EphemeralDevicePreferences()
    let lock = EphemeralAppLockSettingStore()
    var ledgerFileSystem: any LedgerFileSystem = DurableFileSystem()
    /// Before the fixture sync clock (1_800_000_000), so a sync counts as after the import.
    let clock = ExpoClock()

    var storeDirectory: URL {
        root.appending(path: "Library/Application Support/com.mfalicoff.penny/\(ExpoAsyncStorage.directoryName)")
    }
    var deprecatedDirectory: URL { root.appending(path: "Documents/\(ExpoAsyncStorage.directoryName)") }
    var asyncStorage: ExpoAsyncStorage { ExpoAsyncStorage(directories: [storeDirectory, deprecatedDirectory]) }
    var secureStore: ExpoSecureStore { ExpoSecureStore(backend: keychain) }
    var ledgers: LedgerFileStore {
        LedgerFileStore(directory: root.appending(path: "Ledgers"), fileSystem: ledgerFileSystem)
    }
    var journalURL: URL { root.appending(path: "Migration/expo-import.json") }

    func migration() -> ExpoMigration {
        ExpoMigration(
            asyncStorage: asyncStorage, secureStore: secureStore, sessions: sessions, authPreferences: auth,
            devicePreferences: device, lockStore: lock, ledgers: ledgers, journalURL: journalURL,
            now: { [clock] in clock.now })
    }

    func advance(_ seconds: TimeInterval) { clock.advance(seconds) }

    // MARK: Staging what the Expo app wrote

    /// The AsyncStorage key the Expo app used for `name` on `server` (nil: the original server).
    func key(_ name: String, server: String? = nil) -> String {
        ExpoLegacyFormat.storageKey(name, server: server ?? Self.legacyServer, legacyServer: Self.legacyServer)
    }

    func ledgerKey(_ email: String, server: String? = nil) -> String {
        key(ExpoLegacyFormat.ledgerPrefix + email.lowercased(), server: server)
    }

    func stageServer(url: String = legacyServer, legacyUrl: String = legacyServer, version: String? = "1.0.0") throws {
        let connection = ExpoLegacyFormat.ServerConnection(url: url, legacyUrl: legacyUrl, version: version)
        try asyncStorage.set([
            ExpoLegacyFormat.serverConnectionKey: String(decoding: try JSONEncoder().encode(connection), as: UTF8.self)
        ])
    }

    func stageLedger(_ email: String, server: String? = nil, base: Ledger, local: Ledger) throws {
        try asyncStorage.set([ledgerKey(email, server: server): Self.record(base: base, local: local)])
    }

    /// The signed-in account of `server` and, when given, its session token.
    func stageAccount(_ email: String, server: String? = nil, token: String?) throws {
        try asyncStorage.set([key(ExpoLegacyFormat.activeAccountKey, server: server): email])
        if let token {
            try secureStore.set(token, forKey: key(ExpoLegacyFormat.sessionKey, server: server))
        }
    }

    static func record(base: Ledger, local: Ledger) -> String {
        let record = ExpoLegacyFormat.LocalLedger(base: WireLedger(base), local: WireLedger(local))
        return (try? JSONEncoder().encode(record)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }

    func storedValues() throws -> [String: String] { try asyncStorage.load() ?? [:] }
}
