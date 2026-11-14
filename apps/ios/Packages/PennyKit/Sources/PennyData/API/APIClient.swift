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

    public init(data: Data, mime: String, filename: String?) {
        self.data = data
        self.mime = mime
        self.filename = filename
    }
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
        Self.anonymous(configuration, transport: transport)
    }

    /// A client without a session, for server checks and sign-in. It cannot fail: a nil
    /// session cannot belong to another server.
    public static func anonymous(
        _ configuration: APIConfiguration, transport: any HTTPTransport = URLSessionTransport()
    ) -> APIClient {
        APIClient(unchecked: configuration, transport: transport)
    }

    private init(unchecked configuration: APIConfiguration, transport: any HTTPTransport) {
        self.configuration = configuration
        self.session = nil
        self.transport = transport
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

    /// `GET /api/auth/oidc`. Needs no session; `enabled: false` means no single sign-on.
    public func oidcConfiguration() async throws -> WireOidcConfig {
        try await json(.get, "/api/auth/oidc", authenticated: false)
    }

    /// `POST /api/auth/oidc/start`. `redirectUri` must be one the server lists exactly.
    /// The transaction must be 64 lowercase hex characters and the authorization URL HTTPS
    /// (plain HTTP only for a loopback provider), or the answer is `malformedResponse`.
    /// `serverDate` carries the response's `Date` header, so the attempt's lifetime can be
    /// measured without trusting the device clock.
    public func startOidc(redirectUri: String) async throws -> WireOidcChallenge {
        let result = try await perform(
            .post, "/api/auth/oidc/start", body: try JSONEncoder().encode(WireOidcStart(redirectUri: redirectUri)),
            authenticated: false)
        var challenge: WireOidcChallenge = try decode(result.body)
        guard Self.isLowercaseHex64(challenge.transaction), challenge.authorizationURL != nil else {
            throw APIError.malformedResponse
        }
        challenge.serverDate = Self.httpDate(result.headers["date"])
        return challenge
    }

    /// Parses an IMF-fixdate `Date` header ("Sun, 06 Nov 1994 08:49:37 GMT"); nil otherwise.
    static func httpDate(_ text: String?) -> Date? {
        guard let text else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return formatter.date(from: text.trimmingCharacters(in: .whitespaces))
    }

    /// `POST /api/auth/oidc/complete` with the transaction kept from `startOidc` and the full
    /// callback URL. The server consumes the attempt before anything else, so a second call
    /// with the same transaction always fails with 401.
    public func completeOidc(transaction: String, callbackURL: URL) async throws -> ServerSession {
        let callback = callbackURL.absoluteString
        guard Self.isLowercaseHex64(transaction) else { throw APIError.invalidRequest(.invalidField("transaction")) }
        guard callback.utf16.count <= 8192 else { throw APIError.invalidRequest(.invalidField("callbackUrl")) }
        return try makeSession(
            try await json(
                .post, "/api/auth/oidc/complete",
                body: WireOidcComplete(transaction: transaction, callbackUrl: callback), authenticated: false))
    }

    static func isLowercaseHex64(_ text: String) -> Bool {
        text.utf8.count == 64 && text.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
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

    /// Uploads receipt bytes (1 byte to 10 MiB; mime must be one the contract allows).
    /// `progress` receives the fraction of the request body sent (0 to 1), on any thread.
    public func uploadReceipt(
        name: String, mime: String, data: Data, progress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> WireReceipt {
        guard !name.isEmpty, name.utf16.count <= ReceiptRules.maxNameLength else {
            throw APIError.invalidRequest(.invalidField("name"))
        }
        guard ReceiptRules.mimes.contains(mime) else { throw APIError.invalidRequest(.invalidField("mime")) }
        guard !data.isEmpty, data.count <= ReceiptRules.maxBytes else {
            throw APIError.invalidRequest(.invalidField("base64"))
        }
        let body = try JSONEncoder().encode(
            ReceiptUploadBody(name: name, mime: mime, base64: data.base64EncodedString()))
        var report: UploadProgress?
        if let progress {
            report = { sent, total in
                if total > 0 { progress(min(1, Double(sent) / Double(total))) }
            }
        }
        let result = try await perform(
            .post, "/api/receipts", body: body, timeout: configuration.transferTimeout, progress: report)
        return try decode(result.body)
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

    /// One page of `POST /api/v1/search/transactions`. Search failures never gate ledger
    /// access; the two share nothing but the session.
    public func search(_ request: SearchRequest) async throws -> SearchResponse {
        try request.validate()
        let response: SearchResponse = try await json(
            .post, "/api/v1/search/transactions", body: request.normalizedForSending)
        guard response.version == 1, response.totalCount >= 0, response.items.count <= 100 else {
            throw APIError.malformedResponse
        }
        return response
    }

    // MARK: Households

    /// `GET /api/households/projection?month=YYYY-MM`: the caller's share of every household
    /// expense recorded in the month, and previews of the month's shared rules. The server
    /// computes the shares; the app never splits a shared total itself.
    public func householdProjection(month: MonthKey) async throws -> WireHouseholdProjection {
        try await json(.get, "/api/households/projection", query: [URLQueryItem(name: "month", value: "\(month)")])
    }

    // MARK: Plumbing

    enum Method: String {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    private func makeSession(_ wire: WireSession) throws -> ServerSession {
        do {
            return try ServerSession(server: configuration.server, email: wire.email, token: wire.token)
        } catch {
            throw APIError.malformedResponse
        }
    }

    func json<Response: Decodable>(
        _ method: Method, _ path: String, query: [URLQueryItem] = [], authenticated: Bool = true,
        timeout: TimeInterval? = nil
    ) async throws -> Response {
        try decode(
            try await perform(method, path, query: query, authenticated: authenticated, timeout: timeout).body)
    }

    func json<Response: Decodable, Body: Encodable>(
        _ method: Method, _ path: String, body: Body, authenticated: Bool = true, timeout: TimeInterval? = nil
    ) async throws -> Response {
        let data = try JSONEncoder().encode(body)
        return try decode(
            try await perform(method, path, body: data, authenticated: authenticated, timeout: timeout).body)
    }

    func decode<Response: Decodable>(_ data: Data) throws -> Response {
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.malformedResponse
        }
    }

    func perform(
        _ method: Method, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, authenticated: Bool = true,
        timeout: TimeInterval? = nil, progress: UploadProgress? = nil
    ) async throws -> HTTPResult {
        let request = try makeRequest(
            method, path, query: query, body: body, authenticated: authenticated, timeout: timeout)
        let result: HTTPResult
        do {
            try Task.checkCancellation()
            result = try await transport.send(request, progress: progress)
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
        _ method: Method, _ path: String, query: [URLQueryItem] = [], body: Data?, authenticated: Bool,
        timeout: TimeInterval?
    ) throws(APIError) -> URLRequest {
        guard var components = URLComponents(url: configuration.server.url, resolvingAgainstBaseURL: false) else {
            throw .invalidRequest(.wrongServer)
        }
        components.percentEncodedPath += path
        if !query.isEmpty { components.queryItems = query }
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
