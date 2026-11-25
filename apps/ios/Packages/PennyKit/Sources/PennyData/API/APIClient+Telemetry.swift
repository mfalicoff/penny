public import Foundation

/// The two OTLP signals the API takes from the app (MAZ-129).
public enum TelemetrySignal: String, Sendable {
    case traces, logs
}

extension APIClient {
    /// The largest body the app sends: the API's default `ClientTelemetry__MaxPayloadBytes` is
    /// 1 MiB, so batches stay well under it.
    public static let maxTelemetryBody = 512 * 1024

    /// `POST /api/telemetry/otlp/v1/{traces,logs}` with an OTLP/HTTP JSON body and a retry-safe
    /// `Idempotency-Key`. Throws `APIError` as any call does: 404 means the server has client
    /// telemetry off, 429 carries `Retry-After`.
    public func sendTelemetry(_ signal: TelemetrySignal, body: Data, idempotencyKey: String) async throws {
        guard body.count <= Self.maxTelemetryBody else { throw APIError.invalidRequest(.invalidField("body")) }
        guard idempotencyKey.utf8.count >= 8, idempotencyKey.utf8.count <= 64,
            idempotencyKey.utf8.allSatisfy({
                ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95
            })
        else { throw APIError.invalidRequest(.invalidField("Idempotency-Key")) }
        _ = try await perform(
            .post, "/api/telemetry/otlp/v1/\(signal.rawValue)", body: body,
            headers: ["Idempotency-Key": idempotencyKey], timeout: 30)
    }
}
