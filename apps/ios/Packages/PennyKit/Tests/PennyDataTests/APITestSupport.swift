import Foundation
import PennyContracts
import PennyData
import PennyDomain
import Synchronization
import Testing

/// Records requests and answers from a closure. Fixture data, `.test` domains only.
final class StubTransport: HTTPTransport {
    private let requests = Mutex<[URLRequest]>([])
    private let handler: @Sendable (URLRequest) async throws -> HTTPResult

    init(_ handler: @escaping @Sendable (URLRequest) async throws -> HTTPResult) {
        self.handler = handler
    }

    convenience init(status: Int = 200, headers: [String: String] = [:], json: String) {
        self.init { _ in HTTPResult(status: status, headers: headers, body: Data(json.utf8)) }
    }

    var sent: [URLRequest] { requests.withLock { $0 } }

    func send(_ request: URLRequest) async throws -> HTTPResult {
        requests.withLock { $0.append(request) }
        return try await handler(request)
    }
}

enum APIFixtures {
    /// A JSON object body (no nested `#require`, which the macro cannot expand).
    static func object(_ data: Data?) throws -> [String: Any] {
        let data = try #require(data)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    static let server = serverURL("https://penny.example.test")
    static let otherServer = serverURL("https://other.example.test")
    static let token = String(repeating: "ab", count: 32)

    static func serverURL(_ text: String) -> ServerURL {
        do { return try ServerURL(text) } catch { fatalError("Invalid test server \(text)") }
    }

    static func session(server: ServerURL = server, email: String = "contract-user@example.test") -> ServerSession {
        do {
            return try ServerSession(server: server, email: email, token: token)
        } catch {
            fatalError("Invalid test token")
        }
    }

    static func client(
        session: ServerSession? = session(), server: ServerURL = server, transport: any HTTPTransport
    ) throws -> APIClient {
        try APIClient(configuration: APIConfiguration(server: server), session: session, transport: transport)
    }

    /// A member of a shared fixture file, as JSON text.
    static func member(_ file: String, _ key: String) throws -> Data {
        let object = try JSONSerialization.jsonObject(with: Fixtures.data(file))
        let value = try #require(object as? [String: Any])[key]
        return try JSONSerialization.data(withJSONObject: try #require(value), options: [.fragmentsAllowed])
    }

    static func elements(_ file: String, _ key: String) throws -> [Data] {
        let array = try #require(
            try JSONSerialization.jsonObject(with: member(file, key), options: [.fragmentsAllowed]) as? [Any])
        return try array.map { try JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) }
    }
}
