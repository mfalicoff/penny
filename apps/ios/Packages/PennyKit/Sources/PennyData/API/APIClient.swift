public import Foundation
public import PennyDomain

/// Where and how to talk to one server. Timeouts are bounded so a stalled connection
/// always ends.
public struct APIConfiguration: Equatable, Sendable {
    public static let timeoutRange: ClosedRange<TimeInterval> = 1...120

    public let server: ServerURL
    /// For ordinary JSON requests.
    public let requestTimeout: TimeInterval
    /// For receipt upload and download, which move up to 14 MiB.
    public let transferTimeout: TimeInterval

    public init(server: ServerURL, requestTimeout: TimeInterval = 30, transferTimeout: TimeInterval = 120) {
        self.server = server
        self.requestTimeout = min(max(requestTimeout, Self.timeoutRange.lowerBound), Self.timeoutRange.upperBound)
        self.transferTimeout = min(max(transferTimeout, Self.timeoutRange.lowerBound), Self.timeoutRange.upperBound)
    }
}

/// A downloaded receipt.
public struct ReceiptFile: Equatable, Sendable {
    public var data: Data
    public var mime: String
    /// From `Content-Disposition`, when the server sent one.
    public var filename: String?
}

/// The async HTTP client for the Penny API. It is a value type: create one per server, and
/// one with a session per signed-in account. Each call suspends without blocking, honors
/// task cancellation (throwing `CancellationError`) and throws `APIError` otherwise.
///
/// The client never retries by itself and never logs. See docs/ios-api-client.md.
public struct APIClient: Sendable {
    public let configuration: APIConfiguration
    private let session: ServerSession?
    private let transport: any HTTPTransport

    /// - Throws: `.invalidRequest(.wrongServer)` when the session belongs to another
    ///   server than `configuration.server`.
    public init(
        configuration: APIConfiguration, session: ServerSession? = nil,
        transport: any HTTPTransport = URLSessionTransport()
    ) throws(APIError) {
        if let session, session.server != configuration.server { throw .invalidRequest(.wrongServer) }
        self.configuration = configuration
        self.session = session
        self.transport = transport
    }

    /// The same client signed in as `session`.
    public func signedIn(as session: ServerSession) throws(APIError) -> APIClient {
        try APIClient(configuration: configuration, session: session, transport: transport)
    }

    public func signedOut() -> APIClient {
        // A nil session cannot mismatch the server.
        (try? APIClient(configuration: configuration, session: nil, transport: transport)) ?? self
    }

    public var scope: AccountScope? { session?.scope }

    // MARK: Server and account

    /// `GET /api/info`: confirms the address is a Penny server. Needs no session.
    public func info() async throws -> WireServerInfo {
        let info: WireServerInfo = try await json(.get, "/api/info", authenticated: false)
        guard info.name == "penny" else { throw APIError.malformedResponse }
        return info
    }

    public func register(_ credentials: WireCredentials) async throws -> ServerSession {
        try makeSession(try await json(.post, "/api/auth/register", body: credentials, authenticated: false))
    }

    public func login(_ credentials: WireCredentials) async throws -> ServerSession {
        try makeSession(try await json(.post, "/api/auth/login", body: credentials, authenticated: false))
    }

    public func me() async throws -> WireMe {
        try await json(.get, "/api/auth/me")
    }

    /// Revokes the session on the server. The caller removes the stored token either way.
    public func logout() async throws {
        let ok: WireOk = try await json(.post, "/api/auth/logout")
        guard ok.ok else { throw APIError.malformedResponse }
    }

    // MARK: Ledger

    public func ledger() async throws -> LedgerSnapshot {
        try await json(.get, "/api/ledger")
    }

    /// Writes the whole ledger on top of `snapshot.revision`. A stale revision throws
    /// `APIError.conflict` and changes nothing; refetch with `ledger()`, merge and retry.
    public func putLedger(_ snapshot: LedgerSnapshot) async throws -> LedgerSnapshot {
        try await json(.put, "/api/ledger", body: snapshot)
    }

    // MARK: Receipts

    private struct ReceiptUploadBody: Encodable {
        var name: String
        var mime: String
        var base64: String
    }

    /// Uploads receipt bytes (at most 10 MiB; mime must be one the contract allows).
    public func uploadReceipt(name: String, mime: String, data: Data) async throws -> WireReceipt {
        let allowed = [
            "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
        ]
        guard !name.isEmpty, name.utf16.count <= 255 else { throw APIError.invalidRequest(.invalidField("name")) }
        guard allowed.contains(mime) else { throw APIError.invalidRequest(.invalidField("mime")) }
        guard data.count <= 10 * 1024 * 1024 else { throw APIError.invalidRequest(.invalidField("base64")) }
        let body = ReceiptUploadBody(name: name, mime: mime, base64: data.base64EncodedString())
        return try await json(.post, "/api/receipts", body: body, timeout: configuration.transferTimeout)
    }

    public func receipt(id: String) async throws -> ReceiptFile {
        guard !id.isEmpty, id.utf16.count <= 100 else { throw APIError.invalidRequest(.invalidReceiptId) }
        // Percent-encode everything but unreserved characters so an id cannot add path
        // segments, a query or a fragment.
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: unreserved) else {
            throw APIError.invalidRequest(.invalidReceiptId)
        }
        let result = try await perform(.get, "/api/receipts/\(encoded)", timeout: configuration.transferTimeout)
        let contentType = result.headers["content-type"] ?? ""
        let mime = (contentType.split(separator: ";").first.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespaces).lowercased()
        guard !mime.isEmpty, mime != "application/json" else { throw APIError.malformedResponse }
        return ReceiptFile(
            data: result.body, mime: mime, filename: Self.filename(result.headers["content-disposition"]))
    }

    // MARK: Search

    /// One page of `POST /api/v1/search/transactions`. A 404 (`APIError.notFound`) means
    /// this server has no search v1: use local search. Search availability never gates
    /// ledger access; the two share nothing but the session.
    public func search(_ request: SearchRequest) async throws -> SearchResponse {
        try request.validate()
        let response: SearchResponse = try await json(
            .post, "/api/v1/search/transactions", body: request.normalizedForSending)
        guard response.version == 1, response.totalCount >= 0, response.items.count <= 100 else {
            throw APIError.malformedResponse
        }
        return response
    }

    // MARK: Plumbing

    enum Method: String {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
    }

    private func makeSession(_ wire: WireSession) throws -> ServerSession {
        do {
            return try ServerSession(server: configuration.server, email: wire.email, token: wire.token)
        } catch {
            throw APIError.malformedResponse
        }
    }

    private func json<Response: Decodable>(
        _ method: Method, _ path: String, authenticated: Bool = true, timeout: TimeInterval? = nil
    ) async throws -> Response {
        try decode(try await perform(method, path, authenticated: authenticated, timeout: timeout).body)
    }

    private func json<Response: Decodable, Body: Encodable>(
        _ method: Method, _ path: String, body: Body, authenticated: Bool = true, timeout: TimeInterval? = nil
    ) async throws -> Response {
        let data = try JSONEncoder().encode(body)
        return try decode(
            try await perform(method, path, body: data, authenticated: authenticated, timeout: timeout).body)
    }

    private func decode<Response: Decodable>(_ data: Data) throws -> Response {
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.malformedResponse
        }
    }

    private func perform(
        _ method: Method, _ path: String, body: Data? = nil, authenticated: Bool = true, timeout: TimeInterval? = nil
    ) async throws -> HTTPResult {
        let request = try makeRequest(method, path, body: body, authenticated: authenticated, timeout: timeout)
        let result: HTTPResult
        do {
            try Task.checkCancellation()
            result = try await transport.send(request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.from(transport: error)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.unreachable
        }
        // A response that arrives after cancellation is dropped, not delivered.
        try Task.checkCancellation()
        guard (200...299).contains(result.status) else {
            throw APIError.from(status: result.status, headers: result.headers, body: result.body)
        }
        return result
    }

    func makeRequest(
        _ method: Method, _ path: String, body: Data?, authenticated: Bool, timeout: TimeInterval?
    ) throws(APIError) -> URLRequest {
        guard var components = URLComponents(url: configuration.server.url, resolvingAgainstBaseURL: false) else {
            throw .invalidRequest(.wrongServer)
        }
        components.percentEncodedPath += path
        guard let url = components.url, url.host?.lowercased() == configuration.server.url.host?.lowercased() else {
            throw .invalidRequest(.wrongServer)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.timeoutInterval = timeout ?? configuration.requestTimeout
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated {
            // The session's server equals the configured one (checked in init), so the
            // token only ever goes to the server that issued it.
            guard let session else { throw .unauthorized(message: nil) }
            request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Reads `filename*=UTF-8''...` or `filename="..."`.
    static func filename(_ disposition: String?) -> String? {
        guard let disposition else { return nil }
        for part in disposition.split(separator: ";").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if part.lowercased().hasPrefix("filename*=utf-8''") {
                return String(part.dropFirst("filename*=UTF-8''".count)).removingPercentEncoding
            }
        }
        for part in disposition.split(separator: ";").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if part.lowercased().hasPrefix("filename=") {
                let value = String(part.dropFirst("filename=".count))
                return value.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            }
        }
        return nil
    }
}
