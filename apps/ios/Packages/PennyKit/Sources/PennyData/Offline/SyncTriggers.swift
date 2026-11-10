public import Foundation
import Network

/// Reports whether the device has a usable network path. Production uses `NWPathMonitor`;
/// tests drive it by hand.
public protocol NetworkMonitoring: Sendable {
    /// The current reachability, then every change, until the stream is cancelled.
    func reachability() -> AsyncStream<Bool>
}

/// `NWPathMonitor`: satisfied means a route exists, not that the server answers, so the
/// sync engine still treats an unreachable server as a failure to retry.
public struct SystemNetworkMonitor: NetworkMonitoring {
    public init() {}

    public func reachability() -> AsyncStream<Bool> {
        AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in continuation.yield(path.status == .satisfied) }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "penny.network-monitor"))
        }
    }
}

/// Events that change the local calendar day: midnight, a clock change, a time zone change.
/// Due recurrence is materialized again after each.
public protocol CalendarDayMonitoring: Sendable {
    func dayChanges() -> AsyncStream<Void>
}

/// The system notifications for midnight, clock and time zone changes (Foundation, so
/// PennyData stays free of UIKit).
public struct SystemCalendarDayMonitor: CalendarDayMonitoring {
    public init() {}

    public func dayChanges() -> AsyncStream<Void> {
        AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let center = NotificationCenter.default
            let names: [Notification.Name] = [
                .NSCalendarDayChanged, .NSSystemClockDidChange, .NSSystemTimeZoneDidChange,
            ]
            let tokens = names.map { name in
                center.addObserver(forName: name, object: nil, queue: nil) { _ in continuation.yield() }
            }
            let observers = ObserverTokens(tokens)
            continuation.onTermination = { _ in observers.remove(from: center) }
        }
    }
}

/// NotificationCenter observer tokens are opaque objects; they are only handed back to
/// `removeObserver`, never used otherwise.
private final class ObserverTokens: @unchecked Sendable {
    private let tokens: [any NSObjectProtocol]

    init(_ tokens: [any NSObjectProtocol]) { self.tokens = tokens }

    func remove(from center: NotificationCenter) {
        for token in tokens { center.removeObserver(token) }
    }
}

/// When to retry a sync that failed for a reason that can pass (offline excepted: that waits
/// for the network): 15 s, doubling to at most 5 minutes, or the server's Retry-After when
/// it is longer.
public struct SyncBackoff: Sendable {
    public var initial: Duration
    public var maximum: Duration

    public init(initial: Duration = .seconds(15), maximum: Duration = .seconds(300)) {
        self.initial = initial
        self.maximum = maximum
    }

    public func delay(afterFailures failures: Int, retryAfter: TimeInterval?) -> Duration {
        let doubled = initial * (1 << min(max(failures - 1, 0), 10))
        let backoff = min(doubled, maximum)
        guard let retryAfter, retryAfter > 0 else { return backoff }
        return max(backoff, .seconds(min(retryAfter, 3600)))
    }
}
