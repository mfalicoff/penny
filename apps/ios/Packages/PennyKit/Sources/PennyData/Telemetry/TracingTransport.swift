public import Foundation

/// The app's transport to its Penny server with performance and error reporting (MAZ-129). When
/// the person shares performance data, each API call gets a client span and a W3C `traceparent`,
/// so a slow screen links to the API's spans (the API samples by its own rule; a client's flag
/// never decides). When they share crash reports, a server error (5xx) is recorded as an error.
/// Otherwise the request goes out untouched.
///
/// Spans name the method and the scrubbed path (`GET /api/households/:id`): never the host, a
/// query string or a body. Telemetry's own requests are never traced.
public struct TracingTransport: HTTPTransport {
    private let base: any HTTPTransport
    private let recorder: TelemetryRecorder
    private let now: @Sendable () -> Date

    public init(
        base: any HTTPTransport = URLSessionTransport(), recorder: TelemetryRecorder,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.base = base
        self.recorder = recorder
        self.now = now
    }

    public func send(_ request: URLRequest) async throws -> HTTPResult {
        try await send(request, progress: nil)
    }

    public func send(_ request: URLRequest, progress: UploadProgress?) async throws -> HTTPResult {
        let path = request.url.map { TelemetryScrubber.path($0.path) } ?? "/"
        let traces = recorder.tracesRequests
        let errors = recorder.reportsErrors
        guard traces || errors, !path.hasPrefix("/api/telemetry") else {
            return try await base.send(request, progress: progress)
        }
        let method = request.httpMethod ?? "GET"
        let traceID = TraceIDs.traceID()
        let spanID = TraceIDs.spanID()
        var traced = request
        if traces {
            traced.setValue(TraceIDs.traceparent(traceID: traceID, spanID: spanID), forHTTPHeaderField: "traceparent")
        }
        let start = now()
        var attributes: [String: TelemetryValue] = [
            "http.request.method": .string(method), "url.path": .string(path),
        ]
        do {
            let result = try await base.send(traced, progress: progress)
            attributes["http.response.status_code"] = .int(result.status)
            if result.status >= 500 { attributes["error.type"] = .string(String(result.status)) }
            if traces {
                recorder.record(
                    TelemetrySpan(
                        traceID: traceID, spanID: spanID, name: "\(method) \(path)", kind: .client, start: start,
                        end: now(), attributes: attributes, failed: result.status >= 500))
            }
            if errors, result.status >= 500 {
                recorder.record(
                    TelemetryLog(
                        time: now(), severity: .error, body: "Server error on \(method) \(path)",
                        attributes: [
                            "exception.type": "http.server_error", "http.request.method": method, "url.path": path,
                            "http.response.status_code": String(result.status),
                            "trace_id": traces ? traceID : "",
                        ].filter { !$0.value.isEmpty }))
            }
            return result
        } catch {
            if traces {
                attributes["error.type"] = .string(Self.errorType(error))
                recorder.record(
                    TelemetrySpan(
                        traceID: traceID, spanID: spanID, name: "\(method) \(path)", kind: .client, start: start,
                        end: now(), attributes: attributes, failed: true))
            }
            throw error
        }
    }

    /// A transport failure's kind, never its description (which can hold the URL).
    static func errorType(_ error: any Error) -> String {
        if error is CancellationError { return "cancelled" }
        guard let error = error as? URLError else { return "unknown" }
        switch error.code {
        case .cancelled: return "cancelled"
        case .timedOut: return "timeout"
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed: return "offline"
        case .cannotFindHost, .dnsLookupFailed: return "dns"
        case .cannotConnectToHost: return "refused"
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
            .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
            return "tls"
        default: return "network"
        }
    }
}
