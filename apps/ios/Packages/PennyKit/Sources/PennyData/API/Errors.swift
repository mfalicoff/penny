public import Foundation

/// A structured failure from the Penny API. Branch on the case, never on `message`: the
/// server's text is for display and may change. Nothing here contains a credential.
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
    case badRequest(message: String?)
    /// 401: the session is missing, expired or revoked. Sign in again.
    case unauthorized(message: String?)
    /// 403: rejected origin or permission.
    case forbidden(message: String?)
    /// 404: absent or not visible to this account. On search it means the server has no
    /// search v1 and the app falls back to local search.
    case notFound(message: String?)
    /// 409: stale revision or domain conflict. Nothing changed; refetch, merge and retry.
    case conflict(message: String?)
    /// 413: the body was too large.
    case payloadTooLarge(message: String?)
    /// 429: rate limited.
    case rateLimited(retryAfter: TimeInterval?)
    /// 503: temporary (maintenance, search timeout). The write was not applied.
    case unavailable(retryAfter: TimeInterval?, message: String?)
    /// Another 5xx.
    case server(status: Int, message: String?)
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
    /// the write is idempotent or has confirmed it did not apply (see docs/ios-api-client.md).
    public var isRetryable: Bool {
        switch self {
        case .offline, .timeout, .unreachable, .rateLimited, .unavailable, .server: true
        default: false
        }
    }

    /// The server's `Retry-After`, in seconds, when it sent one.
    public var retryAfter: TimeInterval? {
        switch self {
        case .rateLimited(let after): after
        case .unavailable(let after, _): after
        default: nil
        }
    }

    /// True when the person must sign in again.
    public var requiresSignIn: Bool {
        if case .unauthorized = self { return true }
        return false
    }

    static func from(status: Int, headers: [String: String], body: Data) -> APIError {
        let message = (try? JSONDecoder().decode(WireErrorBody.self, from: body))?.error
        let retryAfter = headers["retry-after"].flatMap { TimeInterval($0.trimmingCharacters(in: .whitespaces)) }
        switch status {
        case 400: return .badRequest(message: message)
        case 401: return .unauthorized(message: message)
        case 403: return .forbidden(message: message)
        case 404: return .notFound(message: message)
        case 409: return .conflict(message: message)
        case 413: return .payloadTooLarge(message: message)
        case 429: return .rateLimited(retryAfter: retryAfter)
        case 503: return .unavailable(retryAfter: retryAfter, message: message)
        case 500...599: return .server(status: status, message: message)
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
