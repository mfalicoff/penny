import CryptoKit
public import Foundation
public import PennyDomain
import Security

/// Why a legacy Expo store could not be read or changed. Branch on the case.
public enum ExpoStoreError: Error, Equatable, Sendable {
    /// The store exists but cannot be opened now (data protection before the first unlock, or
    /// a Keychain item that is only readable while the device is unlocked). Try again later;
    /// never treated as missing or corrupt.
    case unavailable
    /// The store exists but is not in the format the Expo app wrote. It is kept untouched.
    case corrupt
    /// Changing the store failed. It is unchanged.
    case writeFailed
}

/// The Expo app's AsyncStorage on iOS (`@react-native-async-storage/async-storage` 2.x,
/// `RNCAsyncStorage.mm`), read and written in its own on-disk format so the native app can
/// import it in place and the Expo build can still read it after a rollback:
///
/// - `Application Support/<bundle id>/RCTAsyncLocalStorage_V1/manifest.json`: a JSON object
///   of every key. A value of at most 1024 UTF-16 units is inlined as a string; a longer one
///   is `null` and lives in a file beside the manifest named by the lowercase MD5 hex of the
///   key (`RCTMD5Hash`).
/// - Builds before AsyncStorage 1.12 used `Documents/RCTAsyncLocalStorage_V1`; the library moved
///   it at startup, so it is only read when the current directory has no manifest.
///
/// See docs/ios-expo-migration.md.
public struct ExpoAsyncStorage: Sendable {
    public static let directoryName = "RCTAsyncLocalStorage_V1"
    public static let manifestName = "manifest.json"
    /// Longer values are stored in their own file (`RCTInlineValueThreshold`).
    static let inlineLimit = 1024

    /// The directories to look in, the current location first.
    public let directories: [URL]
    let fileSystem: any LedgerFileSystem

    public init(directories: [URL], fileSystem: any LedgerFileSystem = DurableFileSystem()) {
        self.directories = directories
        self.fileSystem = fileSystem
    }

    /// The Expo app's AsyncStorage in this app's container (the same bundle id, so the same
    /// container after an in-place upgrade).
    public static func standard(bundleIdentifier: String = AppIdentity.bundleIdentifier) -> ExpoAsyncStorage {
        ExpoAsyncStorage(directories: [
            URL.applicationSupportDirectory.appending(path: bundleIdentifier, directoryHint: .isDirectory)
                .appending(path: directoryName, directoryHint: .isDirectory),
            URL.documentsDirectory.appending(path: directoryName, directoryHint: .isDirectory),
        ])
    }

    /// The directory that holds a manifest, or nil when the Expo app never stored anything.
    public var directory: URL? {
        directories.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent(Self.manifestName).path) }
    }

    /// The overflow file name for `key` (`RCTMD5Hash`: lowercase hex MD5 of its UTF-8 bytes).
    static func fileName(for key: String) -> String {
        Insecure.MD5.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Every key and value, or nil when there is no store. A key whose overflow file is gone
    /// is missing, as the Expo app would read it.
    public func load() throws(ExpoStoreError) -> [String: String]? {
        guard let directory else { return nil }
        guard let manifest = try readManifest(in: directory) else { return nil }
        var values: [String: String] = [:]
        for (key, value) in manifest {
            if let text = value as? String {
                values[key] = text
            } else if value is NSNull {
                let data: Data?
                do {
                    data = try fileSystem.read(directory.appendingPathComponent(Self.fileName(for: key)))
                } catch {
                    throw .unavailable
                }
                guard let data else { continue }
                guard let text = String(data: data, encoding: .utf8) else { throw .corrupt }
                values[key] = text
            }
            // Any other JSON type was never written by AsyncStorage; the key is ignored and
            // stays in the manifest.
        }
        return values
    }

    private func readManifest(in directory: URL) throws(ExpoStoreError) -> [String: Any]? {
        let data: Data?
        do {
            data = try fileSystem.read(directory.appendingPathComponent(Self.manifestName))
        } catch {
            throw .unavailable
        }
        guard let data else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data), let manifest = object as? [String: Any]
        else { throw .corrupt }
        return manifest
    }

    /// Removes `keys` (and their overflow files) and keeps every other key exactly as stored.
    /// The manifest is replaced atomically, so the Expo build reads either the old store or
    /// the new one.
    public func remove(_ keys: Set<String>) throws(ExpoStoreError) {
        guard !keys.isEmpty, let directory, var manifest = try readManifest(in: directory) else { return }
        let present = keys.filter { manifest[$0] != nil }
        guard !present.isEmpty else { return }
        for key in present { manifest[key] = nil }
        try writeManifest(manifest, in: directory)
        for key in present {
            try? fileSystem.remove(directory.appendingPathComponent(Self.fileName(for: key)))
        }
    }

    /// Stores `entries` the way AsyncStorage's `multiSet` does. Used to stage fixtures for
    /// upgrade tests and rehearsals; the importer itself never writes values.
    public func set(_ entries: [String: String]) throws(ExpoStoreError) {
        guard let directory = directory ?? directories.first else { return }
        var manifest = (try readManifest(in: directory)) ?? [:]
        for (key, value) in entries {
            let file = directory.appendingPathComponent(Self.fileName(for: key))
            if value.utf16.count <= Self.inlineLimit {
                manifest[key] = value
                try? fileSystem.remove(file)
            } else {
                do {
                    try fileSystem.write(Data(value.utf8), to: file)
                } catch {
                    throw .writeFailed
                }
                manifest[key] = NSNull()
            }
        }
        try writeManifest(manifest, in: directory)
    }

    private func writeManifest(_ manifest: [String: Any], in directory: URL) throws(ExpoStoreError) {
        do {
            let data = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
            try fileSystem.write(data, to: directory.appendingPathComponent(Self.manifestName))
        } catch {
            throw .writeFailed
        }
    }
}

/// The Expo app's `expo-secure-store` items (57.x, `SecureStoreModule.swift`): generic
/// passwords with service `app:no-auth` (or `app` from SecureStore before SDK 50), account
/// and generic attribute = the key's UTF-8 bytes, value = the UTF-8 string, accessible
/// `WhenUnlocked` (SecureStore's default). Penny never used `requireAuthentication`, so the
/// `app:auth` service is not read: reading it could show a biometric prompt.
public struct ExpoSecureStore: Sendable {
    public static let service = "app:no-auth"
    public static let legacyService = "app"

    private let backend: any KeychainBackend

    public init(backend: any KeychainBackend = SystemKeychain()) {
        self.backend = backend
    }

    func query(_ key: String, service: String) -> [String: Any] {
        let account = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrGeneric as String: account,
            kSecAttrAccount as String: account,
        ]
    }

    /// The value the Expo app saved for `key`, or nil when there is none.
    public func string(forKey key: String) throws(ExpoStoreError) -> String? {
        for service in [Self.service, Self.legacyService] {
            var query = query(key, service: service)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            let (status, data) = backend.copyData(query)
            switch status {
            case errSecSuccess:
                guard let data, let text = String(data: data, encoding: .utf8) else { throw .corrupt }
                return text
            case errSecItemNotFound: continue
            // errSecInteractionNotAllowed (a locked device) and anything else: try again later.
            default: throw .unavailable
            }
        }
        return nil
    }

    /// Deletes `key` under every service the Expo app may have used.
    public func remove(_ key: String) throws(ExpoStoreError) {
        for service in [Self.service, Self.legacyService] {
            let status = backend.delete(query(key, service: service))
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw status == errSecInteractionNotAllowed ? .unavailable : .writeFailed
            }
        }
    }

    /// Saves `value` exactly as `SecureStore.setItemAsync(key, value)` did. Used to stage
    /// fixtures for upgrade tests and rehearsals; the importer itself never writes items.
    public func set(_ value: String, forKey key: String) throws(ExpoStoreError) {
        try remove(key)
        var item = query(key, service: Self.service)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        guard backend.add(item) == errSecSuccess else { throw .writeFailed }
    }
}
