public import Foundation
import Synchronization

/// Collects the app's reports and sends them to the signed-in account's server (MAZ-129), never
/// to a collector: `POST /api/telemetry/otlp/v1/{traces,logs}` with the session's bearer token.
/// Safe to call from any thread; nothing it does can fail, block or slow the app.
///
/// - Spans (performance) are kept in memory, up to `maxSpans`, and dropped when they can't be
///   sent: they're only useful fresh.
/// - Log records (crashes, hangs, errors) wait in `PendingReports` on disk until they're sent,
///   so a crash before sign-in or while offline still arrives.
/// - Nothing is recorded or sent for a kind the person hasn't switched on, in the demo, or while
///   the server doesn't offer client telemetry. A 404 means the server turned it off: the
///   recorder stops for this launch. A 429 pauses it for `Retry-After`.
public final class TelemetryRecorder: Sendable {
    public static let maxSpans = 500
    /// Records per request, well under the API's 2000.
    static let batchSize = 200

    /// Where reports go and what may be sent. Nil destination: signed out (crashes still wait).
    public struct Configuration: Sendable {
        public var choices: TelemetryChoices
        public var destination: APIClient?
        /// `/api/info` reports `telemetry.native`.
        public var offered: Bool
        public var demo: Bool

        public init(choices: TelemetryChoices, destination: APIClient?, offered: Bool, demo: Bool) {
            self.choices = choices
            self.destination = destination
            self.offered = offered
            self.demo = demo
        }

        public static let off = Configuration(choices: .none, destination: nil, offered: false, demo: false)
    }

    private struct State {
        var configuration = Configuration.off
        var spans: [TelemetrySpan] = []
        var pausedUntil: Date?
        /// The server answered 404 this launch.
        var serverOff = false
        var flushScheduled = false
        var flushing = false
    }

    public let resource: TelemetryResource
    private let pending: PendingReports
    private let now: @Sendable () -> Date
    /// How long to gather reports before sending them; nil sends only on `flush()` (tests).
    private let flushDelay: Duration?
    private let state = Mutex(State())

    public init(
        resource: TelemetryResource, pending: PendingReports, flushDelay: Duration? = .seconds(20),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.resource = resource
        self.pending = pending
        self.flushDelay = flushDelay
        self.now = now
    }

    /// A recorder that never records (previews, tests that don't look at telemetry).
    public static func disabled() -> TelemetryRecorder {
        TelemetryRecorder(
            resource: TelemetryResource(
                version: "0", build: "0", osVersion: "0", deviceModel: "unknown", sessionID: "0"),
            pending: PendingReports(file: nil), flushDelay: nil)
    }

    public func configure(_ configuration: Configuration) {
        let flush = state.withLock { state -> Bool in
            if state.configuration.destination?.configuration.server != configuration.destination?.configuration.server
            {
                state.serverOff = false
            }
            state.configuration = configuration
            if !configuration.choices.performance || configuration.demo || configuration.destination == nil {
                state.spans = []
            }
            return Self.sendsAnything(state)
        }
        if !configuration.choices.crashes || configuration.demo { pending.clear() }
        if flush { scheduleFlush() }
    }

    /// Whether API calls get a span and `traceparent`.
    public var tracesRequests: Bool { state.withLock { Self.sendsSpans($0) } }

    /// Whether API failures are recorded as errors.
    public var reportsErrors: Bool { state.withLock { Self.sendsLogs($0) } }

    public func record(_ span: TelemetrySpan) {
        let recorded = state.withLock { state -> Bool in
            guard Self.sendsSpans(state) else { return false }
            state.spans.append(span)
            if state.spans.count > Self.maxSpans { state.spans.removeFirst(state.spans.count - Self.maxSpans) }
            return true
        }
        if recorded { scheduleFlush() }
    }

    /// An error while signed in (a server error from the API).
    public func record(_ log: TelemetryLog) {
        guard state.withLock({ Self.sendsLogs($0) }) else { return }
        pending.add([log], now: now())
        scheduleFlush()
    }

    /// Crashes and hangs from MetricKit. They are kept when crash reports are on, even while
    /// signed out, and sent once someone signs in to a server that takes them.
    public func receiveDiagnostics(_ logs: [TelemetryLog]) {
        let keep = state.withLock { $0.configuration.choices.crashes && !$0.configuration.demo }
        guard keep, !logs.isEmpty else { return }
        pending.add(logs, now: now())
        scheduleFlush()
    }

    /// Sends what's waiting now (the app went to the background, or a test).
    public func flush() async {
        let work = state.withLock { state -> (APIClient, [TelemetrySpan], Bool)? in
            guard !state.flushing, let destination = state.configuration.destination, Self.active(state) else {
                return nil
            }
            if let until = state.pausedUntil, until > now() { return nil }
            state.flushing = true
            state.pausedUntil = nil
            let spans = Self.sendsSpans(state) ? state.spans : []
            state.spans = []
            return (destination, spans, Self.sendsLogs(state))
        }
        guard let (client, spans, sendsLogs) = work else { return }
        defer { state.withLock { $0.flushing = false } }
        var stop = false
        for batch in Self.batches(spans) where !stop {
            stop = await send(.traces, batch, client: client) { [resource] in
                try OTLPJSON.traces($0, resource: resource)
            }
        }
        guard sendsLogs, !stop else { return }
        let logs = pending.take(now: now())
        var unsent: [TelemetryLog] = []
        for batch in Self.batches(logs) {
            if stop {
                unsent += batch
                continue
            }
            stop = await send(.logs, batch, client: client) { [resource] in try OTLPJSON.logs($0, resource: resource) }
            if stop { unsent += batch }
        }
        pending.putBack(unsent, now: now())
    }

    /// Sends `items`, halving a batch whose body is over the size limit. True when sending should
    /// stop for now (the batch wasn't delivered and a retry could be).
    private func send<Item>(
        _ signal: TelemetrySignal, _ items: [Item], client: APIClient, encode: ([Item]) throws -> Data
    ) async -> Bool {
        guard let body = try? encode(items) else { return false }
        if body.count > APIClient.maxTelemetryBody {
            // One record that is too big on its own is dropped.
            guard items.count > 1 else { return false }
            let half = items.count / 2
            if await send(signal, Array(items[..<half]), client: client, encode: encode) { return true }
            return await send(signal, Array(items[half...]), client: client, encode: encode)
        }
        do {
            try await client.sendTelemetry(signal, body: body, idempotencyKey: TraceIDs.idempotencyKey())
            return false
        } catch APIError.notFound {
            state.withLock { $0.serverOff = true }
            return true
        } catch APIError.rateLimited(let after, _) {
            let until = now().addingTimeInterval(min(max(after ?? 60, 1), 3600))
            state.withLock { $0.pausedUntil = until }
            return true
        } catch let error as APIError {
            // Offline, a server problem or an expired session: try again later. A report the
            // server refused (400, 413) would be refused again, so it is dropped.
            switch error {
            case .badRequest, .payloadTooLarge, .invalidRequest, .forbidden, .unexpectedStatus: return false
            default: return true
            }
        } catch {
            return true
        }
    }

    private func scheduleFlush() {
        guard let flushDelay else { return }
        let start = state.withLock { state -> Bool in
            guard !state.flushScheduled, Self.active(state) else { return false }
            state.flushScheduled = true
            return true
        }
        guard start else { return }
        Task.detached(priority: .utility) { [self] in
            try? await Task.sleep(for: flushDelay)
            state.withLock { $0.flushScheduled = false }
            await flush()
        }
    }

    static func batches<Item>(_ items: [Item]) -> [[Item]] {
        stride(from: 0, to: items.count, by: batchSize).map { Array(items[$0..<min($0 + batchSize, items.count)]) }
    }

    private static func active(_ state: State) -> Bool {
        state.configuration.offered && !state.configuration.demo && !state.serverOff
            && state.configuration.destination != nil
    }

    private static func sendsSpans(_ state: State) -> Bool { active(state) && state.configuration.choices.performance }
    private static func sendsLogs(_ state: State) -> Bool { active(state) && state.configuration.choices.crashes }
    private static func sendsAnything(_ state: State) -> Bool { sendsSpans(state) || sendsLogs(state) }
}
