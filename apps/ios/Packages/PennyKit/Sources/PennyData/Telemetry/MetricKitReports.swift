#if os(iOS)
    public import Foundation
    public import MetricKit

    /// Receives MetricKit's diagnostics (crashes and hangs, delivered on the launch after them)
    /// and hands them to the recorder (MAZ-129). Subscribe once, at launch.
    public final class MetricKitReports: NSObject, MXMetricManagerSubscriber, Sendable {
        private let recorder: TelemetryRecorder

        public init(recorder: TelemetryRecorder) {
            self.recorder = recorder
            super.init()
        }

        public func start() {
            MXMetricManager.shared.add(self)
        }

        public func didReceive(_ payloads: [MXDiagnosticPayload]) {
            let now = Date()
            let logs = payloads.flatMap {
                CrashReports.logs(fromDiagnosticJSON: $0.jsonRepresentation(), receivedAt: now)
            }
            recorder.receiveDiagnostics(logs)
        }
    }
#endif
