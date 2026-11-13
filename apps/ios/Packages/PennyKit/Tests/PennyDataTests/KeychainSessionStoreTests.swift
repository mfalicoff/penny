import Foundation
import PennyData
import PennyDomain
import Security
import Testing

@Suite("Keychain session store")
struct KeychainSessionStoreTests {
    private let keychain = FakeKeychain()
    private var store: KeychainSessionStore { KeychainSessionStore(backend: keychain) }
    private let account = APIFixtures.server.url.absoluteString

    @Test("whenSessionSaved_KeychainSessionStore_ShouldRoundTripItForItsServerOnly")
    func roundTrip() throws {
        let session = APIFixtures.session()
        try store.save(session)
        #expect(try store.load(server: APIFixtures.server) == session)
        #expect(try store.load(server: APIFixtures.otherServer) == nil)
    }

    @Test("whenSessionSaved_KeychainSessionStore_ShouldBeThisDeviceOnlyAfterFirstUnlockAndNeverSynced")
    func accessibility() throws {
        try store.save(APIFixtures.session())
        let item = try #require(keychain.items()[account])
        #expect(
            item.attributes[kSecAttrAccessible as String] == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        #expect(item.attributes[kSecAttrSynchronizable as String] == "false")
        #expect(item.attributes[kSecUseDataProtectionKeychain as String] == "true")
        #expect(item.attributes[kSecClass as String] == kSecClassGenericPassword as String)
        #expect(KeychainSessionStore.service == "com.mfalicoff.penny.session")
    }

    @Test("whenSavedTwiceForOneServer_KeychainSessionStore_ShouldReplaceTheEarlierSession")
    func replaces() throws {
        try store.save(APIFixtures.session(email: "first@example.test"))
        let second = try ServerSession(
            server: APIFixtures.server, email: "second@example.test", token: AuthFixtures.otherToken)
        try store.save(second)
        #expect(keychain.items().count == 1)
        #expect(try store.load(server: APIFixtures.server) == second)
    }

    @Test("whenAnEarlierBuildSavedWithOtherAccessibility_KeychainSessionStore_ShouldMoveTheItemToThisDeviceOnly")
    func updateMovesAccessibility() throws {
        let record = #"{"version":1,"server":"\#(account)","email":"a@example.test","token":"\#(APIFixtures.token)"}"#
        keychain.put(account: account, data: Data(record.utf8), accessible: kSecAttrAccessibleWhenUnlocked)
        try store.save(APIFixtures.session())
        #expect(keychain.items().count == 1)
        let item = try #require(keychain.items()[account])
        #expect(
            item.attributes[kSecAttrAccessible as String] == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        #expect(try store.load(server: APIFixtures.server) == APIFixtures.session())
    }

    @Test("whenItemIsOutsideTheDataProtectionKeychain_KeychainSessionStore_ShouldNotReadOrDeleteIt")
    func legacyKeychainItemIgnored() throws {
        let record = #"{"version":1,"server":"\#(account)","email":"a@example.test","token":"\#(APIFixtures.token)"}"#
        keychain.put(account: account, data: Data(record.utf8), dataProtection: false)
        #expect(try store.load(server: APIFixtures.server) == nil)
        try store.deleteAll()
        // The fake keeps the keychains apart as SecItem does: the store's queries never reach it.
        let legacy: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: KeychainSessionStore.service,
            kSecAttrAccount as String: account, kSecReturnData as String: true,
        ]
        #expect(keychain.copyData(legacy).0 == errSecSuccess)
        // A query without a class is refused, as SecItemCopyMatching does.
        #expect(
            keychain.copyData([kSecAttrAccount as String: account, kSecReturnData as String: true]).0 == errSecParam)
    }

    @Test("whenDeviceLocked_KeychainSessionStore_ShouldReportUnavailableAndKeepTheItem")
    func locked() throws {
        try store.save(APIFixtures.session())
        keychain.forcedStatus.withLock { $0 = errSecInteractionNotAllowed }
        #expect(throws: SessionStoreError.unavailable) { try store.load(server: APIFixtures.server) }
        keychain.forcedStatus.withLock { $0 = nil }
        #expect(keychain.items()[account] != nil)
    }

    @Test("whenKeychainFails_KeychainSessionStore_ShouldReportTheStatusOnly")
    func failure() {
        keychain.addStatus.withLock { $0 = errSecNotAvailable }
        #expect(throws: SessionStoreError.failed(errSecNotAvailable)) { try store.save(APIFixtures.session()) }
    }

    @Test("whenItemIsDamaged_KeychainSessionStore_ShouldDeleteItAndReportNoSession")
    func damaged() throws {
        keychain.put(account: account, data: Data("not json".utf8))
        #expect(try store.load(server: APIFixtures.server) == nil)
        #expect(keychain.items()[account] == nil)
    }

    @Test("whenItemNamesAnotherServer_KeychainSessionStore_ShouldNotReturnItsToken")
    func foreignRecord() throws {
        let record =
            #"{"version":1,"server":"https://other.example.test","email":"a@example.test","token":"\#(APIFixtures.token)"}"#
        keychain.put(account: account, data: Data(record.utf8))
        #expect(try store.load(server: APIFixtures.server) == nil)
        #expect(keychain.items()[account] == nil)
    }

    @Test("whenTokenMalformed_KeychainSessionStore_ShouldDropTheItem")
    func malformedToken() throws {
        let record = #"{"version":1,"server":"\#(account)","email":"a@example.test","token":"ABC"}"#
        keychain.put(account: account, data: Data(record.utf8))
        #expect(try store.load(server: APIFixtures.server) == nil)
    }

    @Test("whenDeletingAll_KeychainSessionStore_ShouldRemoveOnlyPennySessions")
    func deleteAll() throws {
        try store.save(APIFixtures.session())
        try store.save(APIFixtures.session(server: APIFixtures.otherServer))
        keychain.put(account: "x", data: Data(), service: "app")
        try store.deleteAll()
        #expect(keychain.items().isEmpty)
        #expect(keychain.items(service: "app").count == 1)
        // Deleting what is not there is not an error.
        try store.delete(server: APIFixtures.server)
        try store.deleteAll()
    }

    @Test("whenSessionPrinted_KeychainSessionStore_ShouldNeverExposeTheToken")
    func redacted() throws {
        try store.save(APIFixtures.session())
        let loaded = try #require(try store.load(server: APIFixtures.server))
        #expect(!String(describing: loaded).contains(APIFixtures.token))
        #expect(!String(reflecting: SessionStoreError.failed(-1)).contains(APIFixtures.token))
    }
}
