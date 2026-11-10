public import Foundation

/// The result of one HTTP exchange, reduced to what the client needs. Header names are
/// lowercased.
public struct HTTPResult: Sendable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

/// Sends one request. Tests substitute a fake; production uses `URLSessionTransport`.
/// Implementations throw `URLError` for network failures and `CancellationError` (or
/// `URLError.cancelled`) when the calling task is cancelled.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResult
}

/// An ephemeral URLSession that never stores cookies or credentials, never follows
/// redirects (a redirect could carry the bearer token to another host) and has a bounded
/// resource timeout.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(resourceTimeout: TimeInterval = 120) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    public func send(_ request: URLRequest) async throws -> HTTPResult {
        let (data, response) = try await session.data(for: request, delegate: RefuseRedirects())
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let key = key as? String, let value = value as? String { headers[key.lowercased()] = value }
        }
        return HTTPResult(status: http.statusCode, headers: headers, body: data)
    }
}

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}
