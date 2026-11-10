import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// An in-memory Penny server for the offline tests: password login, `/me`, logout and the
/// whole-ledger `GET`/`PUT /api/ledger` with the real revision rule (a stale revision is 409
/// and changes nothing). One ledger per email, fixture data only. Faults and gates let a test
/// cut the network, fail requests, force conflicts or hold an answer while it acts.
final class FakeLedgerServer: Sendable {
    enum Fault: Sendable {
        case offline
        case timeout
        case status(Int, retryAfter: Int? = nil)
    }

    struct Account: Sendable {
        var token: String
        var revision: Int
        var ledger: WireLedger
        var revoked = false
    }

    private let accounts = Mutex<[String: Account]>([:])
    /// Faults for the next requests whose "METHOD /path" matches the key.
    private let faults = Mutex<[String: [Fault]]>([:])
    /// Every request fails this way while set ("the network is down", "the server is off").
    let outage = Mutex<Fault?>(nil)
    /// Holds the next request matching the key until the gate opens.
    private let gates = Mutex<[String: Gate]>([:])
    /// Runs before a PUT is checked, once per PUT, to simulate another device writing first.
    let beforePut = Mutex<[@Sendable () -> Void]>([])
    let log = CallLog()

    init() {}

    var transport: StubTransport { StubTransport { [self] request in try await self.answer(request) } }

    // MARK: Setup

    @discardableResult
    func addAccount(_ email: String, ledger: PennyDomain.Ledger = Offline.ledger(), revision: Int = 1) -> String {
        accounts.withLock { accounts in
            let token = String(repeating: String(format: "%02x", accounts.count + 1), count: 32)
            accounts[email] = Account(token: token, revision: revision, ledger: WireLedger(ledger))
            return token
        }
    }

    func ledger(_ email: String) -> PennyDomain.Ledger? {
        accounts.withLock { $0[email] }.flatMap { try? PennyDomain.Ledger(wire: $0.ledger) }
    }

    func revision(_ email: String) -> Int? { accounts.withLock { $0[email]?.revision } }

    /// Another device (the web) saves: applies `change` and bumps the revision.
    func edit(_ email: String, _ change: (inout PennyDomain.Ledger) -> Void) {
        accounts.withLock { accounts in
            guard var account = accounts[email], var ledger = try? PennyDomain.Ledger(wire: account.ledger) else {
                return
            }
            change(&ledger)
            account.ledger = WireLedger(ledger)
            account.revision += 1
            accounts[email] = account
        }
    }

    func revoke(_ email: String) { accounts.withLock { $0[email]?.revoked = true } }

    func fail(_ key: String, with faults: Fault...) { self.faults.withLock { $0[key, default: []] += faults } }

    /// The next request for `key` waits until the returned gate opens.
    func hold(_ key: String) -> Gate {
        let gate = Gate()
        gates.withLock { $0[key] = gate }
        return gate
    }

    // MARK: Routing

    private func answer(_ request: URLRequest) async throws -> HTTPResult {
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        log.record(key)
        if let gate = gates.withLock({ $0.removeValue(forKey: key) }) { await gate.wait() }
        try Task.checkCancellation()
        if let fault = outage.withLock({ $0 })
            ?? faults.withLock({ $0[key]?.isEmpty == false ? $0[key]?.removeFirst() : nil })
        {
            switch fault {
            case .offline: throw URLError(.notConnectedToInternet)
            case .timeout: throw URLError(.timedOut)
            case .status(let status, let retryAfter):
                return Self.json(
                    status, #"{"error":"Fault \#(status)"}"#,
                    headers: retryAfter.map { ["retry-after": "\($0)"] } ?? [:])
            }
        }
        switch key {
        case "POST /api/auth/login":
            let credentials = try JSONDecoder().decode(WireCredentials.self, from: request.httpBody ?? Data())
            guard let account = accounts.withLock({ $0[credentials.email] }) else {
                return Self.json(401, #"{"error":"Invalid email or password."}"#)
            }
            accounts.withLock { $0[credentials.email]?.revoked = false }
            return Self.json(200, #"{"token":"\#(account.token)","email":"\#(credentials.email)"}"#)
        case "POST /api/auth/logout":
            guard let email = authorized(request) else { return Self.unauthorized }
            revoke(email)
            return Self.json(200, #"{"ok":true}"#)
        case "GET /api/auth/me":
            guard let email = authorized(request) else { return Self.unauthorized }
            return Self.json(200, #"{"email":"\#(email)"}"#)
        case "GET /api/ledger":
            guard let email = authorized(request), let account = accounts.withLock({ $0[email] }) else {
                return Self.unauthorized
            }
            return Self.snapshot(LedgerSnapshot(revision: account.revision, ledger: account.ledger))
        case "PUT /api/ledger":
            guard let email = authorized(request) else { return Self.unauthorized }
            let body = try JSONDecoder().decode(LedgerSnapshot.self, from: request.httpBody ?? Data())
            if let race = beforePut.withLock({ $0.isEmpty ? nil : $0.removeFirst() }) { race() }
            return accounts.withLock { accounts in
                guard var account = accounts[email] else { return Self.unauthorized }
                guard body.revision == account.revision else {
                    return Self.json(
                        409, #"{"error":"Your data changed on another device. Please refresh and try again."}"#)
                }
                account.revision += 1
                account.ledger = body.ledger
                accounts[email] = account
                return Self.snapshot(LedgerSnapshot(revision: account.revision, ledger: account.ledger))
            }
        default:
            return Self.json(404, #"{"error":"Not found."}"#)
        }
    }

    private func authorized(_ request: URLRequest) -> String? {
        guard let header = request.value(forHTTPHeaderField: "Authorization"), header.hasPrefix("Bearer ") else {
            return nil
        }
        let token = String(header.dropFirst("Bearer ".count))
        return accounts.withLock { $0.first { $0.value.token == token && !$0.value.revoked }?.key }
    }

    static let unauthorized = json(401, #"{"error":"Unauthorized"}"#)

    static func json(_ status: Int, _ body: String, headers: [String: String] = [:]) -> HTTPResult {
        HTTPResult(status: status, headers: headers, body: Data(body.utf8))
    }

    static func snapshot(_ snapshot: LedgerSnapshot) -> HTTPResult {
        // Encoding a value we built cannot fail.
        HTTPResult(status: 200, body: (try? JSONEncoder().encode(snapshot)) ?? Data())
    }
}

/// File system faults on top of the real durable file system, in a temporary directory.
final class FaultyFileSystem: LedgerFileSystem {
    let base = DurableFileSystem()
    let failWrites = Mutex(false)
    let failReads = Mutex(false)
    let writes = Mutex(0)

    func read(_ url: URL) throws -> Data? {
        if failReads.withLock({ $0 }) { throw CocoaError(.fileReadNoPermission) }
        return try base.read(url)
    }

    func write(_ data: Data, to url: URL) throws {
        if failWrites.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
        try base.write(data, to: url)
        writes.withLock { $0 += 1 }
    }

    func remove(_ url: URL) throws { try base.remove(url) }
    func move(_ source: URL, to destination: URL) throws { try base.move(source, to: destination) }
    func files(in directory: URL) throws -> [URL] { try base.files(in: directory) }
}

/// The real durable file system, except that the first write to `target` blocks (on the
/// writer's thread, as a slow disk would) until `open()`, or fails when `failing`.
final class GatedFileSystem: LedgerFileSystem {
    let base = DurableFileSystem()
    let target: URL
    let failing: Bool
    private let armed = Mutex(true)
    private let entered = Mutex(false)
    private let release = DispatchSemaphore(value: 0)

    init(holding target: URL, failing: Bool = false) {
        self.target = target.standardizedFileURL
        self.failing = failing
    }

    /// Whether the held write has started and is waiting.
    var isHolding: Bool { entered.withLock { $0 } }

    func open() { release.signal() }

    func write(_ data: Data, to url: URL) throws {
        let hold =
            url.standardizedFileURL == target
            && armed.withLock { armed in
                defer { armed = false }; return armed
            }
        if hold {
            if failing { throw CocoaError(.fileWriteOutOfSpace) }
            entered.withLock { $0 = true }
            // Bounded, so a broken test fails instead of hanging.
            _ = release.wait(timeout: .now() + 5)
        }
        try base.write(data, to: url)
    }

    func read(_ url: URL) throws -> Data? { try base.read(url) }
    func remove(_ url: URL) throws { try base.remove(url) }
    func move(_ source: URL, to destination: URL) throws { try base.move(source, to: destination) }
    func files(in directory: URL) throws -> [URL] { try base.files(in: directory) }
}

/// A clock the test moves: the device's local calendar day.
final class TestCalendar: Sendable {
    let day: Mutex<PennyDomain.CalendarDate>

    init(_ day: String) { self.day = Mutex(.day(day)) }

    var today: @Sendable () -> PennyDomain.CalendarDate { { [self] in self.day.withLock { $0 } } }

    func set(_ text: String) { day.withLock { $0 = .day(text) } }
}

/// Network and calendar streams the test drives.
final class TestTriggers: NetworkMonitoring, CalendarDayMonitoring {
    private let network: (AsyncStream<Bool>, AsyncStream<Bool>.Continuation)
    private let days: (AsyncStream<Void>, AsyncStream<Void>.Continuation)

    init(online: Bool = true) {
        network = AsyncStream.makeStream(of: Bool.self)
        days = AsyncStream.makeStream(of: Void.self)
        network.1.yield(online)
    }

    func reachability() -> AsyncStream<Bool> { network.0 }
    func dayChanges() -> AsyncStream<Void> { days.0 }

    func setOnline(_ online: Bool) { network.1.yield(online) }
    func dayChanged() { days.1.yield() }
}

enum Offline {
    static let alex = "alex@example.test"
    static let sam = "sam@example.test"

    /// A temporary store directory, unique per test.
    static func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("penny-offline-\(UUID().uuidString)")
    }

    static func scope(_ email: String = alex) -> AccountScope { AccountScope(server: APIFixtures.server, email: email) }

    static func client(_ server: FakeLedgerServer, email: String = alex) throws -> APIClient {
        let token = server.token(for: email)
        return try APIClient(
            configuration: APIConfiguration(server: APIFixtures.server),
            session: try ServerSession(server: APIFixtures.server, email: email, token: token),
            transport: server.transport)
    }

    static func ledger(_ entries: [LedgerEntry] = [], rules: [RecurringRule] = []) -> PennyDomain.Ledger {
        PennyDomain.Ledger(
            accounts: [PaymentAccount(id: "visa", name: "Visa", type: .credit)], transactions: entries,
            recurring: rules)
    }

    static func entry(
        _ id: String, _ date: String = "2026-11-02", title: String = "Coffee", note: String = "", share: Int64 = 640
    ) -> LedgerEntry {
        LedgerEntry(
            id: id, title: title, kind: .expense, total: share, share: share, categoryId: "food", date: .day(date),
            note: note)
    }

    static func rule(_ id: String, next: String) -> RecurringRule {
        RecurringRule(
            id: id, title: "Rent", kind: .expense, total: 120_000, share: 120_000, categoryId: "home",
            date: .day("2026-01-01"), frequency: .monthly, nextDate: .day(next), anchorDay: 1)
    }

    static func store(
        _ directory: URL, fileSystem: any LedgerFileSystem = DurableFileSystem(), calendar: TestCalendar,
        retry: ConflictRetryPolicy = .immediate()
    ) -> OfflineLedgerStore {
        OfflineLedgerStore(
            files: LedgerFileStore(directory: directory, fileSystem: fileSystem), today: calendar.today,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }, retry: retry)
    }
}

extension FakeLedgerServer {
    func token(for email: String) -> String { accounts.withLock { $0[email]?.token ?? "" } }
}

extension PennyDomain.CalendarDate {
    static func day(_ text: String) -> PennyDomain.CalendarDate {
        guard let date = PennyDomain.CalendarDate(text) else { preconditionFailure("\(text) is not a date") }
        return date
    }
}

/// Waits (up to two seconds) for asynchronous work driven by the model to reach a state.
@MainActor
func eventually(_ what: Comment, _ condition: @MainActor () async -> Bool) async {
    for _ in 0..<400 {
        if await condition() { return }
        try? await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("Timed out waiting: \(what)")
}
