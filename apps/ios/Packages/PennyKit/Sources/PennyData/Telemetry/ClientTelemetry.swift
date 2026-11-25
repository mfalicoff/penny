public import Foundation
import Observation

/// The app's opt-in crash and performance reporting (MAZ-129): the person's choices, whether to
/// ask, and the recorder that sends to the signed-in server. One per app process.
///
/// Reports are offered only when the server's `/api/info` says `telemetry.native` (the operator
/// set `ClientTelemetry__OtlpEndpoint`), and only for an account: the demo never sends anything.
@MainActor
@Observable
public final class ClientTelemetry {
    public private(set) var choices: TelemetryChoices
    @ObservationIgnored public let recorder: TelemetryRecorder
    @ObservationIgnored private let store: any TelemetryChoiceStore
    @ObservationIgnored private var destination: APIClient?
    @ObservationIgnored private var offered = false
    @ObservationIgnored private var demo = false
    @ObservationIgnored private var launchRecorded = false
    @ObservationIgnored private let processStart: Date?
    @ObservationIgnored private let now: @Sendable () -> Date

    public init(
        store: any TelemetryChoiceStore, recorder: TelemetryRecorder, processStart: Date? = ProcessInfo.startDate,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.recorder = recorder
        self.processStart = processStart
        self.now = now
        choices = store.load()
        apply()
    }

    /// Never asks and never sends (previews and tests).
    public static func disabled() -> ClientTelemetry {
        ClientTelemetry(store: EphemeralTelemetryChoiceStore(), recorder: .disabled(), processStart: nil)
    }

    /// The account and server reports would go to. `account` nil: signed out or the demo. Reports
    /// use only that account's own session, to its own server.
    public func update(account: SignedInAccount?, offered: Bool, demo: Bool, transport: any HTTPTransport) {
        self.offered = offered
        self.demo = demo
        destination = account.map(\.session).flatMap {
            try? APIClient(configuration: APIConfiguration(server: $0.server), session: $0, transport: transport)
        }
        apply()
    }

    /// Ask "Help fix problems faster?" once per install, for an account on a server that takes
    /// reports.
    public func shouldAsk(offered: Bool, demo: Bool) -> Bool { offered && !demo && !choices.decided }

    /// The prompt's answer: Share reports turns on both kinds, Don't share neither.
    public func answerPrompt(share: Bool) {
        save(TelemetryChoices(crashes: share, performance: share, decided: true))
    }

    public func setCrashes(_ on: Bool) {
        var next = choices
        next.crashes = on
        next.decided = true
        save(next)
    }

    public func setPerformance(_ on: Bool) {
        var next = choices
        next.performance = on
        next.decided = true
        save(next)
    }

    /// The cold launch, from process start to the first frame of the signed-in shell. Once per
    /// process, and only when performance data is shared.
    public func recordLaunch() {
        guard !launchRecorded, let processStart else { return }
        launchRecorded = true
        let end = now()
        // A launch longer than a minute was the system pre-warming the process, not a person waiting.
        guard end.timeIntervalSince(processStart) < 60 else { return }
        recorder.record(TelemetrySpan(name: "app.launch", kind: .internal, start: processStart, end: end))
    }

    /// Sends what's waiting (the app went to the background).
    public func flush() {
        let recorder = recorder
        Task.detached(priority: .utility) { await recorder.flush() }
    }

    private func save(_ next: TelemetryChoices) {
        choices = next
        store.save(next)
        apply()
    }

    private func apply() {
        recorder.configure(
            TelemetryRecorder.Configuration(choices: choices, destination: destination, offered: offered, demo: demo))
    }
}

extension ProcessInfo {
    /// When this process started, from the kernel; nil if it can't be read.
    public static var startDate: Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0 else { return nil }
        let time = info.kp_proc.p_un.__p_starttime
        guard time.tv_sec > 0 else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(time.tv_sec) + TimeInterval(time.tv_usec) / 1_000_000)
    }

    /// The hardware model identifier (`iPhone18,1`), never the device's name.
    public static var deviceModelIdentifier: String {
        #if targetEnvironment(simulator)
            if let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return model }
        #endif
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return machine.isEmpty ? "unknown" : machine
    }
}

extension TelemetryResource {
    /// This app's resource: its version and build, the OS version and the device model, with a
    /// new random session id.
    public static func current(bundle: Bundle = .main) -> TelemetryResource {
        let info = bundle.infoDictionary ?? [:]
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return TelemetryResource(
            version: info["CFBundleShortVersionString"] as? String ?? "0",
            build: info["CFBundleVersion"] as? String ?? "0",
            osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            deviceModel: ProcessInfo.deviceModelIdentifier, sessionID: TraceIDs.spanID())
    }
}
