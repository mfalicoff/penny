public import Foundation

/// A structured failure from the Penny API. Branch on the case and its `code`, never on `message`:
/// the server's text is for display and may change. Nothing here contains a credential.
///
/// Each status case carries the `code` the server sent (contract 2.1.0, MAZ-187). It is nil from a
/// server before 2.1.0, and may be one `APIErrorCode` doesn't name from a newer one: treat both like
/// the status alone.
///
/// Cancellation is not an `APIError`: a cancelled request throws `CancellationError`.
public enum APIError: Error, Equatable, Sendable {
    /// No network (airplane mode, connection lost). Safe to retry when back online.
    case offline
    /// The request or its connection timed out.
    case timeout
    /// The server could not be reached (DNS, refused, TLS failure).
    case unreachable
    /// 400: the request was invalid.
    case badRequest(message: String?, code: APIErrorCode? = nil)
    /// 401: the session is missing, expired or revoked. Sign in again.
    case unauthorized(message: String?, code: APIErrorCode? = nil)
    /// 403: rejected origin or permission.
    case forbidden(message: String?, code: APIErrorCode? = nil)
    /// 404: absent or not visible to this account. On search it means the server has no
    /// search v1 and the app falls back to local search.
    case notFound(message: String?, code: APIErrorCode? = nil)
    /// 409: stale revision or domain conflict. Nothing changed; refetch, merge and retry.
    case conflict(message: String?, code: APIErrorCode? = nil)
    /// 413: the body was too large.
    case payloadTooLarge(message: String?, code: APIErrorCode? = nil)
    /// 429: rate limited.
    case rateLimited(retryAfter: TimeInterval?, code: APIErrorCode? = nil)
    /// 503: temporary (maintenance, search timeout). The write was not applied.
    case unavailable(retryAfter: TimeInterval?, message: String?, code: APIErrorCode? = nil)
    /// Another 5xx.
    case server(status: Int, message: String?, code: APIErrorCode? = nil)
    /// A status the contract does not define for the operation, including redirects.
    case unexpectedStatus(Int)
    /// A 2xx whose body does not match the contract.
    case malformedResponse
    /// The request was refused before sending: it breaks a contract limit or would send a
    /// credential to a server other than the one it belongs to.
    case invalidRequest(InvalidRequest)

    public enum InvalidRequest: Error, Equatable, Sendable {
        case invalidField(String)
        case wrongServer
        case invalidReceiptId
        case invalidToken
    }

    /// Whether repeating the same request later can succeed without a change to it.
    /// Reads may retry on their own; writes should be retried only by a caller that knows
    /// the write is idempotent or has confirmed it did not apply (see docs/ios/api-client.md).
    public var isRetryable: Bool {
        switch self {
        case .offline, .timeout, .unreachable, .rateLimited, .unavailable, .server: true
        default: false
        }
    }

    /// The server's `Retry-After`, in seconds, when it sent one.
    public var retryAfter: TimeInterval? {
        switch self {
        case .rateLimited(let after, _): after
        case .unavailable(let after, _, _): after
        default: nil
        }
    }

    /// The server's machine-readable name for the failure, when it sent one (contract 2.1.0).
    public var code: APIErrorCode? {
        switch self {
        case .badRequest(_, let code), .unauthorized(_, let code), .forbidden(_, let code), .notFound(_, let code),
            .conflict(_, let code), .payloadTooLarge(_, let code), .rateLimited(_, let code),
            .unavailable(_, _, let code), .server(_, _, let code):
            code
        case .offline, .timeout, .unreachable, .unexpectedStatus, .malformedResponse, .invalidRequest: nil
        }
    }

    /// The HTTP status of a server answer; nil when there was none (offline, refused before sending).
    public var status: Int? {
        switch self {
        case .badRequest: 400
        case .unauthorized: 401
        case .forbidden: 403
        case .notFound: 404
        case .conflict: 409
        case .payloadTooLarge: 413
        case .rateLimited: 429
        case .unavailable: 503
        case .server(let status, _, _), .unexpectedStatus(let status): status
        case .offline, .timeout, .unreachable, .malformedResponse, .invalidRequest: nil
        }
    }

    /// The server's message, when it sent one. For display only.
    public var message: String? {
        switch self {
        case .badRequest(let message, _), .unauthorized(let message, _), .forbidden(let message, _),
            .notFound(let message, _), .conflict(let message, _), .payloadTooLarge(let message, _),
            .unavailable(_, let message, _), .server(_, let message, _):
            message
        default: nil
        }
    }

    /// Whether this is the failure a 2.1.0 server names `code`. A server from before 2.1.0 sends no
    /// code, so then `legacy` decides: the match on its status and message the app made before
    /// codes existed. A code that differs is never the failure, whatever the message says.
    public func matches(_ code: APIErrorCode, legacy: (APIError) -> Bool) -> Bool {
        if let sent = self.code { return sent == code }
        return legacy(self)
    }

    /// `matches(_:legacy:)` where a server before 2.1.0 is matched by its message containing
    /// `legacyText` (case-insensitive), as the app did before codes existed.
    public func matches(_ code: APIErrorCode, legacyText: String) -> Bool {
        matches(code) { $0.message?.localizedCaseInsensitiveContains(legacyText) == true }
    }

    /// True when the person must sign in again.
    public var requiresSignIn: Bool {
        if case .unauthorized = self { return true }
        return false
    }

    static func from(status: Int, headers: [String: String], body: Data) -> APIError {
        let wire = try? JSONDecoder().decode(WireErrorBody.self, from: body)
        let message = wire?.error
        let code = wire?.code.map(APIErrorCode.init(rawValue:))
        let retryAfter = headers["retry-after"].flatMap { TimeInterval($0.trimmingCharacters(in: .whitespaces)) }
        switch status {
        case 400: return .badRequest(message: message, code: code)
        case 401: return .unauthorized(message: message, code: code)
        case 403: return .forbidden(message: message, code: code)
        case 404: return .notFound(message: message, code: code)
        case 409: return .conflict(message: message, code: code)
        case 413: return .payloadTooLarge(message: message, code: code)
        case 429: return .rateLimited(retryAfter: retryAfter, code: code)
        case 503: return .unavailable(retryAfter: retryAfter, message: message, code: code)
        case 500...599: return .server(status: status, message: message, code: code)
        default: return .unexpectedStatus(status)
        }
    }

    static func from(transport error: URLError) -> APIError {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
            .offline
        case .timedOut:
            .timeout
        default:
            .unreachable
        }
    }
}
