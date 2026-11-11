import Foundation
import PennyData
import PennyDomain
import Security
import Testing

@testable import Penny

/// The Expo import against the real Keychain and container of the signed app on the simulator:
/// the items are written exactly as expo-secure-store 57 writes them (`SecureStoreModule.swift`),
/// not through the importer, so a mismatch in the query would show here.
@Suite("Expo SecureStore (real Keychain)", .serialized)
struct ExpoSecureStoreKeychainTests {
    private let key = "penny-test-expo-item"

    private func expoQuery(service: String) -> [String: Any] {
        let account = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrGeneric as String: account,
            kSecAttrAccount as String: account,
        ]
    }

    private func remove() {
        for service in ["app:no-auth", "app:auth", "app"] { SecItemDelete(expoQuery(service: service) as CFDictionary) }
    }

    @Test("whenExpoSecureStoreSavedAnItem_ExpoSecureStore_ShouldReadAndRemoveItFromTheRealKeychain")
    func readsExpoItems() throws {
        remove()
        defer { remove() }
        var item = expoQuery(service: "app:no-auth")
        item[kSecValueData as String] = Data("catppuccin".utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        #expect(SecItemAdd(item as CFDictionary, nil) == errSecSuccess)

        let store = ExpoSecureStore()
        #expect(try store.string(forKey: key) == "catppuccin")
        try store.remove(key)
        #expect(try store.string(forKey: key) == nil)
        #expect(SecItemCopyMatching(expoQuery(service: "app:no-auth") as CFDictionary, nil) == errSecItemNotFound)
    }

    @Test("whenStagedByTheRehearsalFixture_ExpoSecureStore_ShouldWriteWhatExpoSecureStoreReads")
    func writesExpoItems() throws {
        remove()
        defer { remove() }
        try ExpoSecureStore().set("true", forKey: key)
        var query = expoQuery(service: "app:no-auth")
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        #expect(SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess)
        #expect((result as? Data).flatMap { String(data: $0, encoding: .utf8) } == "true")
    }

    @Test("whenRunInTheApp_ExpoAsyncStorage_ShouldLookWhereAsyncStorageWritesForThisBundle")
    func storageLocation() {
        let storage = ExpoAsyncStorage.standard()
        #expect(Bundle.main.bundleIdentifier == AppIdentity.bundleIdentifier)
        #expect(
            storage.directories.first?.path.hasSuffix(
                "Library/Application Support/com.mfalicoff.penny/RCTAsyncLocalStorage_V1") == true)
        #expect(storage.directories.last?.path.hasSuffix("Documents/RCTAsyncLocalStorage_V1") == true)
    }

    @Test("whenTheFixtureVariableIsSet_TestControls_ShouldStageOnlyForUpgrade")
    func fixtureVariable() {
        #expect(TestControls.fromProcess(["PENNY_TEST_EXPO_FIXTURE": "upgrade"]).stagesExpoFixture)
        #expect(!TestControls.fromProcess(["PENNY_TEST_EXPO_FIXTURE": "1"]).stagesExpoFixture)
        #expect(!TestControls.fromProcess([:]).stageExpoFixture())
    }
}
