import Foundation
import PennyDomain
import Security
import Synchronization

public enum AppLockStoreError: Error, Equatable, Sendable {
    /// The Keychain is closed (before the first unlock after a restart).
    case unavailable
    /// The saved value is not one this app wrote.
    case corrupt
    case failed(Int32)
}

/// Where the lock's on/off setting lives. A read that fails must leave the app locked
/// (`AppLockController` fails closed), so this is a throwing read, not a default value.
public protocol AppLockSettingStore: Sendable {
    func read() throws(AppLockStoreError) -> Bool
    func write(_ enabled: Bool) throws(AppLockStoreError)
}

/// The setting in the Keychain, on this device only and never synced.
public struct KeychainAppLockSettingStore: AppLockSettingStore {
    public static let service = "\(AppIdentity.bundleIdentifier).app-lock"
    static let account = "enabled"

    private let backend: any KeychainBackend

    public init(backend: any KeychainBackend = SystemKeychain()) {
        self.backend = backend
    }

    var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public func read() throws(AppLockStoreError) -> Bool {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, data) = backend.copyData(query)
        switch status {
        case errSecSuccess: break
        case errSecItemNotFound: return false
        default: throw Self.error(status)
        }
        switch data.flatMap({ String(data: $0, encoding: .utf8) }) {
        case "true": return true
        case "false": return false
        default: throw .corrupt
        }
    }

    public func write(_ enabled: Bool) throws(AppLockStoreError) {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(String(enabled).utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = backend.update(query, attributes)
        switch updated {
        case errSecSuccess: return
        case errSecItemNotFound: break
        default: throw Self.error(updated)
        }
        var item = query.merging(attributes) { _, new in new }
        item[kSecAttrSynchronizable as String] = false
        item[kSecAttrLabel as String] = "Penny app lock"
        let added = backend.add(item)
        guard added == errSecSuccess else { throw Self.error(added) }
    }

    static func error(_ status: OSStatus) -> AppLockStoreError {
        status == errSecInteractionNotAllowed ? .unavailable : .failed(status)
    }
}

/// The setting in memory, for previews and tests. `failReads`/`failWrites` simulate a closed
/// or broken Keychain.
public final class EphemeralAppLockSettingStore: AppLockSettingStore {
    private struct State {
        var enabled: Bool
        var failReads: AppLockStoreError?
        var failWrites: AppLockStoreError?
    }
    private let state: Mutex<State>

    public init(enabled: Bool = false, failReads: AppLockStoreError? = nil, failWrites: AppLockStoreError? = nil) {
        state = Mutex(State(enabled: enabled, failReads: failReads, failWrites: failWrites))
    }

    public var stored: Bool { state.withLock { $0.enabled } }

    public func setFailures(reads: AppLockStoreError?, writes: AppLockStoreError?) {
        state.withLock {
            $0.failReads = reads
            $0.failWrites = writes
        }
    }

    public func read() throws(AppLockStoreError) -> Bool {
        let (enabled, failure) = state.withLock { ($0.enabled, $0.failReads) }
        if let failure { throw failure }
        return enabled
    }

    public func write(_ enabled: Bool) throws(AppLockStoreError) {
        let failure = state.withLock { $0.failWrites }
        if let failure { throw failure }
        state.withLock { $0.enabled = enabled }
    }
}
