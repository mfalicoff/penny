import Foundation
import PennyData
import Security
import Testing

/// The lock setting against the real Keychain of the signed app on the simulator.
@Suite("App lock setting (real Keychain)", .serialized)
struct AppLockSettingKeychainTests {
    private let store = KeychainAppLockSettingStore()

    private func remove() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainAppLockSettingStore.service,
            kSecUseDataProtectionKeychain as String: true,
        ]
        SecItemDelete(query as CFDictionary)
    }

    @Test("whenSavedInTheAppKeychain_KeychainAppLockSettingStore_ShouldRoundTripAndSurviveANewStore")
    func roundTrip() throws {
        remove()
        defer { remove() }
        #expect(try store.read() == false)
        try store.write(true)
        #expect(try KeychainAppLockSettingStore().read(), "a new process reads the saved setting")
        try store.write(false)
        #expect(try store.read() == false)
    }
}
