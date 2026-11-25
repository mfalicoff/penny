public import Foundation

/// One attribute value in a report. Only what OTLP's `AnyValue` calls scalars.
public enum TelemetryValue: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
}

/// W3C trace context ids (lowercase hex, never all zeros).
public enum TraceIDs {
    /// 16 random bytes, 32 hex characters.
    public static func traceID() -> String { random(bytes: 16) }
    /// 8 random bytes, 16 hex characters.
    public static func spanID() -> String { random(bytes: 8) }

    /// `traceparent` for a sampled span of `traceID` (version 00, flags 01).
    public static func traceparent(traceID: String, spanID: String) -> String { "00-\(traceID)-\(spanID)-01" }

    /// A retry-safe `Idempotency-Key` the API accepts (8 to 64 of `[A-Za-z0-9_-]`).
    public static func idempotencyKey() -> String { random(bytes: 16) }

    private static func random(bytes count: Int) -> String {
        var generator = SystemRandomNumberGenerator()
        while true {
            let bytes = (0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) }
            if bytes.contains(where: { $0 != 0 }) { return bytes.map { String(format: "%02x", $0) }.joined() }
        }
    }
}

/// A finished span: an API call, or the app's launch.
public struct TelemetrySpan: Equatable, Sendable {
    public enum Kind: Int, Sendable {
        case `internal` = 1
        case client = 3
    }

    public var traceID: String
    public var spanID: String
    public var name: String
    public var kind: Kind
    public var start: Date
    public var end: Date
    public var attributes: [String: TelemetryValue]
    public var failed: Bool

    public init(
        traceID: String = TraceIDs.traceID(), spanID: String = TraceIDs.spanID(), name: String, kind: Kind,
        start: Date, end: Date, attributes: [String: TelemetryValue] = [:], failed: Bool = false
    ) {
        self.traceID = traceID
        self.spanID = spanID
        self.name = name
        self.kind = kind
        self.start = start
        self.end = end
        self.attributes = attributes
        self.failed = failed
    }
}

/// A log record: an error (severity ERROR), a hang (WARN) or a crash (FATAL), which the
/// **Penny clients** dashboard and the crash alert read (docs/self-hosting/observability.md).
public struct TelemetryLog: Codable, Equatable, Sendable {
    public enum Severity: Int, Codable, Sendable {
        case warn = 13
        case error = 17
        case fatal = 21

        var text: String {
            switch self {
            case .warn: "WARN"
            case .error: "ERROR"
            case .fatal: "FATAL"
            }
        }
    }

    public var time: Date
    public var severity: Severity
    public var body: String
    /// String attributes only, so a record can wait on disk (`PendingReports`).
    public var attributes: [String: String]

    public init(time: Date, severity: Severity, body: String, attributes: [String: String] = [:]) {
        self.time = time
        self.severity = severity
        self.body = body
        self.attributes = attributes
    }
}

/// What every report says about where it comes from. No user, account, server or device id:
/// the session id is random per launch.
public struct TelemetryResource: Equatable, Sendable {
    public static let serviceName = "penny-ios"

    public var version: String
    public var build: String
    public var osVersion: String
    public var deviceModel: String
    public var sessionID: String

    public init(version: String, build: String, osVersion: String, deviceModel: String, sessionID: String) {
        self.version = version
        self.build = build
        self.osVersion = osVersion
        self.deviceModel = deviceModel
        self.sessionID = sessionID
    }

    var attributes: [String: TelemetryValue] {
        [
            "service.name": .string(Self.serviceName),
            "service.version": .string(version),
            "service.build": .string(build),
            "os.name": .string("iOS"),
            "os.version": .string(osVersion),
            "device.model.identifier": .string(deviceModel),
            "session.id": .string(sessionID),
            "telemetry.sdk.name": .string("penny-ios"),
            "telemetry.sdk.language": .string("swift"),
        ]
    }
}

/// OTLP/HTTP JSON bodies (https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding), the
/// only encoding `POST /api/telemetry/otlp/v1/{traces,logs}` accepts. Ids are hex, times are
/// nanoseconds since 1970 as strings, and attributes are sorted, so a body is reproducible.
public enum OTLPJSON {
    static let scope = Scope(name: "penny-ios", version: nil)

    public static func traces(_ spans: [TelemetrySpan], resource: TelemetryResource) throws -> Data {
        let body = TracesBody(resourceSpans: [
            ResourceSpans(
                resource: Resource(attributes: attributes(resource.attributes)),
                scopeSpans: [ScopeSpans(scope: scope, spans: spans.map(Span.init))])
        ])
        return try encoder.encode(body)
    }

    public static func logs(_ logs: [TelemetryLog], resource: TelemetryResource) throws -> Data {
        let body = LogsBody(resourceLogs: [
            ResourceLogs(
                resource: Resource(attributes: attributes(resource.attributes)),
                scopeLogs: [ScopeLogs(scope: scope, logRecords: logs.map(LogRecord.init))])
        ])
        return try encoder.encode(body)
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    /// Whole seconds and the fraction apart, so a 2026 instant keeps its microseconds exactly.
    static func nanoseconds(_ date: Date) -> String {
        let time = max(0, date.timeIntervalSince1970)
        let seconds = time.rounded(.down)
        let fraction = min(UInt64(((time - seconds) * 1_000_000).rounded()) * 1_000, 999_999_000)
        return String(UInt64(seconds) * 1_000_000_000 + fraction)
    }

    static func attributes(_ values: [String: TelemetryValue]) -> [KeyValue] {
        values.sorted { $0.key < $1.key }.map { KeyValue(key: $0.key, value: AnyValue($0.value)) }
    }

    // MARK: Wire shapes

    struct TracesBody: Encodable { var resourceSpans: [ResourceSpans] }
    struct LogsBody: Encodable { var resourceLogs: [ResourceLogs] }
    struct ResourceSpans: Encodable {
        var resource: Resource
        var scopeSpans: [ScopeSpans]
    }
    struct ResourceLogs: Encodable {
        var resource: Resource
        var scopeLogs: [ScopeLogs]
    }
    struct Resource: Encodable { var attributes: [KeyValue] }
    struct Scope: Encodable {
        var name: String
        var version: String?
    }
    struct ScopeSpans: Encodable {
        var scope: Scope
        var spans: [Span]
    }
    struct ScopeLogs: Encodable {
        var scope: Scope
        var logRecords: [LogRecord]
    }
    struct KeyValue: Encodable {
        var key: String
        var value: AnyValue
    }

    struct AnyValue: Encodable {
        let value: TelemetryValue
        init(_ value: TelemetryValue) { self.value = value }

        private enum CodingKeys: String, CodingKey { case stringValue, intValue, doubleValue, boolValue }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            switch value {
            case .string(let text): try container.encode(text, forKey: .stringValue)
            // OTLP JSON writes 64-bit integers as strings.
            case .int(let number): try container.encode(String(number), forKey: .intValue)
            case .double(let number): try container.encode(number, forKey: .doubleValue)
            case .bool(let flag): try container.encode(flag, forKey: .boolValue)
            }
        }
    }

    struct Status: Encodable {
        /// 1 ok, 2 error.
        var code: Int
    }

    struct Span: Encodable {
        var traceId: String
        var spanId: String
        var name: String
        var kind: Int
        var startTimeUnixNano: String
        var endTimeUnixNano: String
        var attributes: [KeyValue]
        var status: Status

        init(_ span: TelemetrySpan) {
            traceId = span.traceID
            spanId = span.spanID
            name = span.name
            kind = span.kind.rawValue
            startTimeUnixNano = OTLPJSON.nanoseconds(span.start)
            endTimeUnixNano = OTLPJSON.nanoseconds(max(span.start, span.end))
            attributes = OTLPJSON.attributes(span.attributes)
            status = Status(code: span.failed ? 2 : 1)
        }
    }

    struct LogRecord: Encodable {
        var timeUnixNano: String
        var observedTimeUnixNano: String
        var severityNumber: Int
        var severityText: String
        var body: AnyValue
        var attributes: [KeyValue]

        init(_ log: TelemetryLog) {
            timeUnixNano = OTLPJSON.nanoseconds(log.time)
            observedTimeUnixNano = timeUnixNano
            severityNumber = log.severity.rawValue
            severityText = log.severity.text
            body = AnyValue(.string(log.body))
            attributes = OTLPJSON.attributes(log.attributes.mapValues { .string($0) })
        }
    }
}
