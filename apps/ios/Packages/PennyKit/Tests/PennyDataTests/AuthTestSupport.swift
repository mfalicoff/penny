import Foundation
import PennyData
import PennyDomain
import Security
import Synchronization
import Testing

/// A Keychain stand-in for generic passwords. It models the parts of `SecItem*` the store
/// relies on, so a query that would miss (or hit the wrong item) on a device misses here too:
///
/// - `kSecClass` must be `kSecClassGenericPassword` (anything else is `errSecParam`);
/// - `kSecUseDataProtectionKeychain`: an item lives in the data protection keychain or the
///   macOS file-based keychain, and a query only sees the one it names (absent = file-based, as
///   on macOS);
/// - `kSecAttrSynchronizable`: absent or false in a query matches only non-synced items,
///   `kSecAttrSynchronizableAny` matches both;
/// - `kSecMatchLimit`: `copyData` returns one item's data, so it needs `kSecReturnData`
///   and `kSecMatchLimitOne` (or no limit);
/// - the primary key is class + service + account + synchronizable + keychain, so a second
///   `add` of the same item is `errSecDuplicateItem`, and `update` changes the attributes it
///   is given (data, accessibility) in place.
///
/// Access groups, access control and every other attribute are recorded but not interpreted.
final class FakeKeychain: KeychainBackend {
    /// Attribute values as text (CFString contents, "true"/"false"), so items stay Sendable.
    struct Item {
        var attributes: [String: String]
        var data: Data

        var service: String? { attributes[kSecAttrService as String] }
        var account: String? { attributes[kSecAttrAccount as String] }
        var isSynchronizable: Bool { attributes[kSecAttrSynchronizable as String] == "true" }
        var isDataProtection: Bool { attributes[kSecUseDataProtectionKeychain as String] == "true" }
    }

    private let state = Mutex<[Item]>([])
    /// Status every call returns instead of working, to simulate a locked device.
    let forcedStatus = Mutex<OSStatus?>(nil)
    let addStatus = Mutex<OSStatus?>(nil)
    let deleteStatus = Mutex<OSStatus?>(nil)

    private static func text(_ attributes: [String: Any]) -> [String: String] {
        attributes.filter { $0.key != kSecValueData as String }.mapValues { "\($0)" }
    }

    private static func isGenericPassword(_ query: [String: Any]) -> Bool {
        (query[kSecClass as String] as? String) == (kSecClassGenericPassword as String)
    }

    /// Whether `item` is one `query` selects, as `SecItemCopyMatching`/`Update`/`Delete` would.
    private static func matches(_ query: [String: Any], _ item: Item) -> Bool {
        let text = Self.text(query)
        if let service = text[kSecAttrService as String], service != item.service { return false }
        if let account = text[kSecAttrAccount as String], account != item.account { return false }
        if (text[kSecUseDataProtectionKeychain as String] == "true") != item.isDataProtection { return false }
        let synchronizable = text[kSecAttrSynchronizable as String]
        if synchronizable == String(kSecAttrSynchronizableAny) { return true }
        return item.isSynchronizable == (synchronizable == "true")
    }

    /// The store's items in the data protection keychain, by account.
    func items(service: String = KeychainSessionStore.service) -> [String: Item] {
        state.withLock { items in
            Dictionary(
                items.filter { $0.service == service && $0.isDataProtection }.map { ($0.account ?? "", $0) }
            ) { first, _ in first }
        }
    }

    /// Plants an item directly, as an earlier build or another app might have left it.
    func put(
        account: String, data: Data, service: String = KeychainSessionStore.service,
        accessible: CFString = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, dataProtection: Bool = true
    ) {
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account, kSecAttrAccessible as String: accessible,
            kSecUseDataProtectionKeychain as String: dataProtection, kSecAttrSynchronizable as String: false,
        ]
        state.withLock { $0.append(Item(attributes: Self.text(attributes), data: data)) }
    }

    func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
        if let forced = forcedStatus.withLock({ $0 }) { return (forced, nil) }
        let limit = query[kSecMatchLimit as String] as? String
        guard Self.isGenericPassword(query), query[kSecReturnData as String] as? Bool == true,
            limit == nil || limit == (kSecMatchLimitOne as String)
        else { return (errSecParam, nil) }
        guard let item = state.withLock({ $0.first { Self.matches(query, $0) } }) else {
            return (errSecItemNotFound, nil)
        }
        return (errSecSuccess, item.data)
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) ?? addStatus.withLock({ $0 }) { return forced }
        guard Self.isGenericPassword(attributes), attributes[kSecAttrService as String] is String,
            attributes[kSecAttrAccount as String] is String, let data = attributes[kSecValueData as String] as? Data
        else { return errSecParam }
        let item = Item(attributes: Self.text(attributes), data: data)
        return state.withLock { items in
            let duplicate = items.contains {
                $0.service == item.service && $0.account == item.account
                    && $0.isSynchronizable == item.isSynchronizable && $0.isDataProtection == item.isDataProtection
            }
            if duplicate { return errSecDuplicateItem }
            items.append(item)
            return errSecSuccess
        }
    }

    func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard Self.isGenericPassword(query), attributes[kSecClass as String] == nil else { return errSecParam }
        return state.withLock { items in
            var found = false
            for index in items.indices where Self.matches(query, items[index]) {
                found = true
                items[index].attributes.merge(Self.text(attributes)) { _, new in new }
                if let data = attributes[kSecValueData as String] as? Data { items[index].data = data }
            }
            return found ? errSecSuccess : errSecItemNotFound
        }
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) ?? deleteStatus.withLock({ $0 }) { return forced }
        guard Self.isGenericPassword(query) else { return errSecParam }
        return state.withLock { items in
            let before = items.count
            items.removeAll { Self.matches(query, $0) }
            return items.count == before ? errSecItemNotFound : errSecSuccess
        }
    }
}

/// Answers each API path from a table; unknown paths are 404. Records every request, and
/// also into `log` when given, so a test can order requests against the other fakes' calls.
enum Routes {
    typealias Answer = @Sendable (URLRequest) async throws -> HTTPResult

    static func transport(_ routes: [String: Answer], log: CallLog? = nil) -> StubTransport {
        StubTransport { request in
            let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
            log?.record(key)
            guard let answer = routes[key] else { return HTTPResult(status: 404, body: Data(#"{"error":"x"}"#.utf8)) }
            return try await answer(request)
        }
    }

    static func json(_ body: String) -> Answer { json(200, body) }

    static func json(_ status: Int, _ body: String, headers: [String: String] = [:]) -> Answer {
        { _ in HTTPResult(status: status, headers: headers, body: Data(body.utf8)) }
    }

    static func fail(_ code: URLError.Code) -> Answer {
        { _ in throw URLError(code) }
    }

    static func session(_ email: String, token: String = APIFixtures.token) -> String {
        #"{"token":"\#(token)","email":"\#(email)"}"#
    }
}

extension StubTransport {
    func paths() -> [String] { sent.map { "\($0.httpMethod ?? "GET") \($0.url?.path ?? "")" } }
}

/// Lets a test hold a response until it has changed the state underneath it.
final class Gate: Sendable {
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation

    init() {
        (stream, continuation) = AsyncStream<Void>.makeStream()
    }

    func open() { continuation.yield() }

    func wait() async {
        for await _ in stream { return }
    }
}

/// Records calls in order across the fakes, so tests can check sequencing.
final class CallLog: Sendable {
    private let calls = Mutex<[String]>([])
    func record(_ call: String) { calls.withLock { $0.append(call) } }
    var all: [String] { calls.withLock { $0 } }
}

final class FakeLocalData: AccountLocalData {
    let pending = Mutex<[AccountScope: Int]>([:])
    let syncError = Mutex<(any Error)?>(nil)
    let removeError = Mutex<(any Error)?>(nil)
    let moveError = Mutex<(any Error)?>(nil)
    /// When set, `syncPendingChanges` waits for it before answering.
    let syncGate = Mutex<Gate?>(nil)
    let log: CallLog

    init(log: CallLog = CallLog()) { self.log = log }

    func pendingChangeCount(for scope: AccountScope) async -> Int { pending.withLock { $0[scope] ?? 0 } }

    func syncPendingChanges(for scope: AccountScope, using client: APIClient) async throws {
        log.record("sync \(scope.email)")
        if let gate = syncGate.withLock({ $0 }) { await gate.wait() }
        if let error = syncError.withLock({ $0 }) { throw error }
        pending.withLock { $0[scope] = 0 }
    }

    /// Sign-out holds per scope (`beginRemoval` not yet balanced by a removal or a cancel).
    let holds = Mutex<[AccountScope: Int]>([:])

    func beginRemoval(for scope: AccountScope) async -> Int {
        holds.withLock { $0[scope, default: 0] += 1 }
        return pending.withLock { $0[scope] ?? 0 }
    }

    func cancelRemoval(for scope: AccountScope) async { holds.withLock { $0[scope, default: 0] -= 1 } }

    func removeLocalData(for scope: AccountScope) async throws {
        log.record("remove \(scope.email)")
        if let error = removeError.withLock({ $0 }) { throw error }
        pending.withLock { $0[scope] = nil }
        holds.withLock { $0[scope] = nil }
    }

    func moveLocalData(from old: AccountScope, to new: AccountScope) async throws {
        log.record("move \(old.email) -> \(new.email)")
        if let error = moveError.withLock({ $0 }) { throw error }
        pending.withLock { $0[new, default: 0] += $0.removeValue(forKey: old) ?? 0 }
    }
}

struct FakeDevices: DeviceRegistration {
    let log: CallLog
    func unregister(using client: APIClient) async { log.record("unregister \(client.scope?.email ?? "-")") }
    func signOutCancelled(using client: APIClient) async {
        log.record("signOutCancelled \(client.scope?.email ?? "-")")
    }
}

/// Returns the callback a test chooses, or throws (CancellationError = the person closed it).
final class FakeAuthenticator: WebAuthenticator {
    private let answer: @Sendable (URL) throws -> URL
    let opened = Mutex<[URL]>([])

    init(_ answer: @escaping @Sendable (URL) throws -> URL) {
        self.answer = answer
    }

    static func callback(_ query: String = "state=s1&code=c1") -> FakeAuthenticator {
        FakeAuthenticator { _ in
            guard let url = URL(string: "penny://auth/callback?\(query)") else { throw URLError(.badURL) }
            return url
        }
    }

    func authenticate(at url: URL, callbackScheme: String) async throws -> URL {
        opened.withLock { $0.append(url) }
        #expect(callbackScheme == "penny")
        return try answer(url)
    }
}

enum AuthFixtures {
    static let server = APIFixtures.server
    static let otherToken = String(repeating: "cd", count: 32)
    static let transaction = String(repeating: "0f", count: 32)
    static let info = #"{"name":"penny","version":"2.0.0"}"#
    /// The `Date` header for 1_800_000_000 s, the fixture clock.
    static let serverDate = "Fri, 15 Jan 2027 08:00:00 GMT"

    static func challenge(expiresAt: Int64 = 4_102_444_800_000, url: String = "https://id.example.test/authorize")
        -> String
    {
        #"{"transaction":"\#(transaction)","authorizationUrl":"\#(url)","expiresAt":\#(expiresAt)}"#
    }

    @MainActor
    static func controller(
        transport: StubTransport, sessions: any SessionStore = EphemeralSessionStore(),
        preferences: any AuthPreferences = EphemeralAuthPreferences(server: SavedServer(server: server)),
        localData: any AccountLocalData = NoLocalAccountData(), log: CallLog = CallLog(),
        defaultServer: ServerURL? = nil, now: Date = Date(timeIntervalSince1970: 1_800_000_000)
    ) -> AuthController {
        AuthController(
            defaultServer: defaultServer, sessions: sessions, preferences: preferences, transport: transport,
            localData: localData, devices: FakeDevices(log: log), now: { now })
    }
}
