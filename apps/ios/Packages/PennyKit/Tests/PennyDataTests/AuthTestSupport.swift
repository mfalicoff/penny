import Foundation
import PennyData
import PennyDomain
import Security
import Synchronization
import Testing

/// A Keychain stand-in that interprets the store's queries the way `SecItem*` does for
/// generic passwords (service + optional account), and records what was written.
final class FakeKeychain: KeychainBackend {
    /// Attribute values as text (CFString contents, "true"/"false"), so items stay Sendable.
    struct Item {
        var attributes: [String: String]
        var data: Data
    }

    private let state = Mutex<[String: [String: Item]]>([:])
    /// Status every call returns instead of working, to simulate a locked device.
    let forcedStatus = Mutex<OSStatus?>(nil)
    let addStatus = Mutex<OSStatus?>(nil)

    private static func text(_ attributes: [String: Any]) -> [String: String] {
        attributes.filter { $0.key != kSecValueData as String }.mapValues { "\($0)" }
    }

    private static func key(_ query: [String: Any], _ name: CFString) -> String? {
        query[name as String] as? String
    }

    func items(service: String = KeychainSessionStore.service) -> [String: Item] {
        state.withLock { $0[service] ?? [:] }
    }

    func put(account: String, data: Data, service: String = KeychainSessionStore.service) {
        state.withLock { $0[service, default: [:]][account] = Item(attributes: [:], data: data) }
    }

    func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
        if let forced = forcedStatus.withLock({ $0 }) { return (forced, nil) }
        guard let service = Self.key(query, kSecAttrService), let account = Self.key(query, kSecAttrAccount) else {
            return (errSecParam, nil)
        }
        guard let item = state.withLock({ $0[service]?[account] }) else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, item.data)
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) ?? addStatus.withLock({ $0 }) { return forced }
        guard let service = Self.key(attributes, kSecAttrService), let account = Self.key(attributes, kSecAttrAccount),
            let data = attributes[kSecValueData as String] as? Data
        else { return errSecParam }
        return state.withLock { items in
            if items[service]?[account] != nil { return errSecDuplicateItem }
            items[service, default: [:]][account] = Item(attributes: Self.text(attributes), data: data)
            return errSecSuccess
        }
    }

    func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard let service = Self.key(query, kSecAttrService), let account = Self.key(query, kSecAttrAccount) else {
            return errSecParam
        }
        return state.withLock { items in
            guard var item = items[service]?[account] else { return errSecItemNotFound }
            item.attributes.merge(Self.text(attributes)) { _, new in new }
            if let data = attributes[kSecValueData as String] as? Data { item.data = data }
            items[service]?[account] = item
            return errSecSuccess
        }
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        if let forced = forcedStatus.withLock({ $0 }) { return forced }
        guard let service = Self.key(query, kSecAttrService) else { return errSecParam }
        return state.withLock { items in
            if let account = Self.key(query, kSecAttrAccount) {
                return items[service]?.removeValue(forKey: account) == nil ? errSecItemNotFound : errSecSuccess
            }
            return items.removeValue(forKey: service) == nil ? errSecItemNotFound : errSecSuccess
        }
    }
}

/// Answers each API path from a table; unknown paths are 404. Records every request.
enum Routes {
    typealias Answer = @Sendable (URLRequest) async throws -> HTTPResult

    static func transport(_ routes: [String: Answer]) -> StubTransport {
        StubTransport { request in
            let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
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
    let log: CallLog

    init(log: CallLog = CallLog()) { self.log = log }

    func pendingChangeCount(for scope: AccountScope) async -> Int { pending.withLock { $0[scope] ?? 0 } }

    func syncPendingChanges(for scope: AccountScope, using client: APIClient) async throws {
        log.record("sync \(scope.email)")
        if let error = syncError.withLock({ $0 }) { throw error }
        pending.withLock { $0[scope] = 0 }
    }

    func removeLocalData(for scope: AccountScope) async throws { log.record("remove \(scope.email)") }
}

struct FakeDevices: DeviceRegistration {
    let log: CallLog
    func unregister(using client: APIClient) async { log.record("unregister \(client.scope?.email ?? "-")") }
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
