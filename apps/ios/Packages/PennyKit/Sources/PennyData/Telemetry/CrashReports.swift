public import Foundation
import Synchronization

/// Turns MetricKit's diagnostics (`MXDiagnosticPayload.jsonRepresentation()`) into log records
/// (MAZ-129). The system delivers a crash on the launch after it, so a crash is a FATAL record
/// sent then, as the observability contract says; a hang is a WARN record.
///
/// A record keeps only what helps fix the problem: the exception and signal, the app version
/// that crashed, and the crashed thread's frames as binary name, address, binary UUID and offset,
/// which the archive's dSYMs symbolicate (docs/ios/monitoring.md). MetricKit's region format,
/// memory region details and Objective-C exception messages are dropped: a message can quote
/// what was on screen.
public enum CrashReports {
    /// Frames kept from the crashed thread.
    public static let maxFrames = 64

    public static func logs(fromDiagnosticJSON data: Data, receivedAt now: Date) -> [TelemetryLog] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        let time = date(root["timeStampEnd"]) ?? now
        var logs: [TelemetryLog] = []
        for crash in root["crashDiagnostics"] as? [[String: Any]] ?? [] {
            logs.append(log(crash, kind: "crash", time: time))
        }
        for hang in root["hangDiagnostics"] as? [[String: Any]] ?? [] {
            logs.append(log(hang, kind: "hang", time: time))
        }
        return logs
    }

    private static func log(_ diagnostic: [String: Any], kind: String, time: Date) -> TelemetryLog {
        let meta = diagnostic["diagnosticMetaData"] as? [String: Any] ?? [:]
        var attributes: [String: String] = ["penny.diagnostic": kind]
        let type: String
        if kind == "crash" {
            type = exceptionType(meta)
        } else {
            type = "hang"
            if let duration = meta["hangDuration"] as? String {
                attributes["penny.hang.duration"] = TelemetryScrubber.text(duration)
            }
        }
        attributes["exception.type"] = type
        if let version = meta["appVersion"] as? String { attributes["penny.crash.app_version"] = version }
        if let build = meta["appBuildVersion"] as? String { attributes["penny.crash.app_build"] = build }
        if let os = meta["osVersion"] as? String { attributes["penny.crash.os_version"] = os }
        if let architecture = meta["platformArchitecture"] as? String {
            attributes["penny.crash.architecture"] = architecture
        }
        if let reason = meta["terminationReason"] as? String {
            attributes["penny.crash.termination_reason"] = TelemetryScrubber.text(reason)
        }
        let frames = Self.frames(diagnostic["callStackTree"] as? [String: Any])
        if !frames.isEmpty { attributes["exception.stacktrace"] = frames.joined(separator: "\n") }
        return TelemetryLog(
            time: time, severity: kind == "crash" ? .fatal : .warn,
            body: kind == "crash" ? "Crash: \(type)" : "Hang", attributes: attributes)
    }

    /// "EXC_BAD_ACCESS (SIGSEGV)", from the Mach exception type and the signal.
    static func exceptionType(_ meta: [String: Any]) -> String {
        let exception = (meta["exceptionType"] as? NSNumber).map { machException($0.intValue) }
        let signal = (meta["signal"] as? NSNumber).map { signalName($0.intValue) }
        switch (exception, signal) {
        case (let exception?, let signal?): return "\(exception) (\(signal))"
        case (let exception?, nil): return exception
        case (nil, let signal?): return signal
        case (nil, nil): return "crash"
        }
    }

    private static func machException(_ code: Int) -> String {
        switch code {
        case 1: "EXC_BAD_ACCESS"
        case 2: "EXC_BAD_INSTRUCTION"
        case 3: "EXC_ARITHMETIC"
        case 4: "EXC_EMULATION"
        case 5: "EXC_SOFTWARE"
        case 6: "EXC_BREAKPOINT"
        case 10: "EXC_CRASH"
        case 11: "EXC_RESOURCE"
        case 12: "EXC_GUARD"
        default: "EXC_\(code)"
        }
    }

    private static func signalName(_ code: Int) -> String {
        switch code {
        case 4: "SIGILL"
        case 5: "SIGTRAP"
        case 6: "SIGABRT"
        case 8: "SIGFPE"
        case 9: "SIGKILL"
        case 10: "SIGBUS"
        case 11: "SIGSEGV"
        case 13: "SIGPIPE"
        default: "SIG\(code)"
        }
    }

    /// The attributed (crashed) thread's frames, innermost first, one per line:
    /// `Penny 0x0000000102a4c8f4 1f0c…c2a1 + 0x248f4`. No frame numbers: the scrubber redacts
    /// bare numbers, and the order already gives them. UUIDs are written without dashes for the
    /// same reason.
    static func frames(_ tree: [String: Any]?) -> [String] {
        let stacks = tree?["callStacks"] as? [[String: Any]] ?? []
        guard
            let stack = stacks.first(where: { ($0["threadAttributed"] as? Bool) == true }) ?? stacks.first,
            var frame = (stack["callStackRootFrames"] as? [[String: Any]])?.first
        else { return [] }
        var lines: [String] = []
        while lines.count < maxFrames {
            lines.append(line(frame))
            guard let next = (frame["subFrames"] as? [[String: Any]])?.first else { break }
            frame = next
        }
        return lines
    }

    private static func line(_ frame: [String: Any]) -> String {
        let name = (frame["binaryName"] as? String).map(binaryName) ?? "???"
        let address = (frame["address"] as? NSNumber)?.uint64Value ?? 0
        let offset = (frame["offsetIntoBinaryTextSegment"] as? NSNumber)?.uint64Value ?? 0
        let uuid = (frame["binaryUUID"] as? String).map { $0.replacingOccurrences(of: "-", with: "").lowercased() }
        return "\(name) 0x\(String(format: "%016llx", address)) \(uuid ?? "unknown") + 0x\(String(offset, radix: 16))"
    }

    /// A binary's file name only: never a path, which could hold a device or user name.
    private static func binaryName(_ name: String) -> String {
        let file = name.split(separator: "/").last.map(String.init) ?? name
        let allowed = file.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || "._-+".unicodeScalars.contains($0)
        }
        return allowed.isEmpty ? "???" : String(String.UnicodeScalarView(allowed))
    }

    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        for format in ["yyyy-MM-dd HH:mm:ss Z", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ssZ"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }
}

/// Crash and hang records that arrived while they couldn't be sent: signed out, offline, or
/// before the server answered. They wait on disk until the next export, so a crash before sign-in
/// is sent after it ("buffer until sign-in", MAZ-129). Bounded: the newest `capacity` records
/// younger than `maxAge`; anything older is dropped.
public final class PendingReports: Sendable {
    public static let capacity = 50
    public static let maxAge: TimeInterval = 14 * 24 * 60 * 60

    private let file: URL?
    private let memory = Mutex<[TelemetryLog]?>(nil)

    /// `file` nil keeps them in memory only (tests and previews).
    public init(file: URL?) {
        self.file = file
    }

    /// In Application Support, excluded from backups.
    public static func standard() -> PendingReports {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return PendingReports(file: directory?.appendingPathComponent("Telemetry/pending-reports.json"))
    }

    public func add(_ logs: [TelemetryLog], now: Date) {
        guard !logs.isEmpty else { return }
        update(now: now) { $0 += logs }
    }

    /// Takes every waiting record; `putBack` returns the ones that couldn't be sent.
    public func take(now: Date) -> [TelemetryLog] {
        var taken: [TelemetryLog] = []
        update(now: now) {
            taken = $0
            $0 = []
        }
        return taken
    }

    public func putBack(_ logs: [TelemetryLog], now: Date) { add(logs, now: now) }

    /// Drops everything (the person turned crash reports off).
    public func clear() { update(now: Date()) { $0 = [] } }

    public var count: Int { memory.withLock { ($0 ?? read()).count } }

    private func update(now: Date, _ change: (inout [TelemetryLog]) -> Void) {
        memory.withLock { stored in
            var logs = Self.bounded(stored ?? read(), now: now)
            change(&logs)
            logs = Self.bounded(logs, now: now)
            stored = logs
            write(logs)
        }
    }

    private static func bounded(_ logs: [TelemetryLog], now: Date) -> [TelemetryLog] {
        Array(logs.filter { now.timeIntervalSince($0.time) < maxAge }.sorted { $0.time < $1.time }.suffix(capacity))
    }

    private func read() -> [TelemetryLog] {
        guard let file, let data = try? Data(contentsOf: file) else { return [] }
        return (try? JSONDecoder().decode([TelemetryLog].self, from: data)) ?? []
    }

    private func write(_ logs: [TelemetryLog]) {
        guard var file else { return }
        if logs.isEmpty {
            try? FileManager.default.removeItem(at: file)
            return
        }
        try? FileManager.default.createDirectory(
            at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard
            (try? JSONEncoder().encode(logs).write(
                to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil
        else { return }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? file.setResourceValues(values)
    }
}
