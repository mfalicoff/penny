import Foundation
import PennyData
import PennyDomain
import Security
import Testing

/// The Keychain adapter against the real Keychain of the signed app on the simulator
/// (host package tests use a fake backend: a bare test process has no Keychain access).
@Suite("Keychain session store (real Keychain)", .serialized)
struct RealKeychainSessionStoreTests {
    private let store = KeychainSessionStore()
    private let server = try? ServerURL("https://keychain-check.example.test")

    @Test("whenSavedInTheAppKeychain_KeychainSessionStore_ShouldRoundTripReplaceAndDelete")
    func roundTrip() throws {
        let server = try #require(server)
        defer { try? store.delete(server: server) }
        let first = try ServerSession(
            server: server, email: "first@example.test", token: String(repeating: "ab", count: 32))
        let second = try ServerSession(
            server: server, email: "second@example.test", token: String(repeating: "cd", count: 32))

        try store.save(first)
        #expect(try store.load(server: server) == first)
        try store.save(second)
        #expect(try store.load(server: server) == second)
        try store.delete(server: server)
        #expect(try store.load(server: server) == nil)
    }

    @Test("whenSaved_KeychainItem_ShouldBeThisDeviceOnlyAndNotSynchronizable")
    func attributes() throws {
        let server = try #require(server)
        defer { try? store.delete(server: server) }
        try store.save(
            try ServerSession(server: server, email: "a@example.test", token: String(repeating: "ab", count: 32)))
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainSessionStore.service,
            kSecAttrAccount as String: server.url.absoluteString,
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        #expect(SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess)
        let attributes = try #require(result as? [String: Any])
        #expect(
            attributes[kSecAttrAccessible as String] as? String
                == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        #expect((attributes[kSecAttrSynchronizable as String] as? Bool ?? false) == false)
    }
}
