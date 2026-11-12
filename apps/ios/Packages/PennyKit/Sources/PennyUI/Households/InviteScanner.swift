import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import AVFoundation
    import UIKit
#endif

/// Camera access for the invite scanner, behind a protocol so the denied path is tested
/// without a camera. Access is asked for only when the scanner opens, never at launch.
protocol CameraAccess: Sendable {
    func status() -> CameraAccessStatus
    func request() async -> Bool
}

enum CameraAccessStatus: Equatable, Sendable {
    case notDetermined, authorized, denied
    /// No camera (the simulator, a Mac) or the camera is restricted by device management.
    case unavailable
}

/// What the scanner shows, decided without a camera (MAZ-75).
@MainActor
@Observable
final class InviteScannerModel {
    enum State: Equatable {
        case asking
        case scanning
        case denied
        case unavailable
        /// The camera read something that isn't a usable invite.
        case rejected(String)
    }

    private(set) var state: State = .asking
    @ObservationIgnored private let access: any CameraAccess
    @ObservationIgnored let allowsLoopbackHTTP: Bool

    init(access: any CameraAccess, allowsLoopbackHTTP: Bool) {
        self.access = access
        self.allowsLoopbackHTTP = allowsLoopbackHTTP
    }

    /// Asks for camera access if it was never asked, then shows the camera or why it can't.
    func start() async {
        switch access.status() {
        case .authorized: state = .scanning
        case .denied: state = .denied
        case .unavailable: state = .unavailable
        case .notDetermined:
            state = .asking
            state = await access.request() ? .scanning : .denied
        }
    }

    /// A code the camera read. Returns the invite to use, or nil (and says why) for anything
    /// else; scanning goes on after a rejected code.
    func read(_ payload: String) -> InviteLink? {
        do {
            let link = try InviteLink(scanned: payload, allowsLoopbackHTTP: allowsLoopbackHTTP)
            state = .scanning
            return link
        } catch {
            state = .rejected(HouseholdStartSheet.message(error))
            return nil
        }
    }
}

/// The QR scanner on the join screen. Denying the camera leaves typed entry working: the
/// denied state offers Type the code instead and a link to Settings.
struct InviteScannerView: View {
    let onScan: (InviteLink) -> Void
    let onTypeCode: () -> Void
    @State private var model: InviteScannerModel
    @Environment(\.dismiss) private var dismiss

    init(
        allowsLoopbackHTTP: Bool, access: (any CameraAccess)? = nil, onScan: @escaping (InviteLink) -> Void,
        onTypeCode: @escaping () -> Void
    ) {
        self.onScan = onScan
        self.onTypeCode = onTypeCode
        _model = State(
            initialValue: InviteScannerModel(
                access: access ?? SystemCameraAccess(), allowsLoopbackHTTP: allowsLoopbackHTTP))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Scan invite")
                .inlineNavigationTitle()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                            .accessibilityIdentifier("scanner.close")
                    }
                }
        }
        .task { await model.start() }
        .accessibilityIdentifier("screen.inviteScanner")
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .asking:
            PennyStateView(.loading, title: "Asking for the camera…")
        case .scanning, .rejected:
            VStack(spacing: 16) {
                CameraPreview { payload in
                    if let link = model.read(payload) { onScan(link) }
                }
                .clipShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                .accessibilityLabel("Camera viewfinder")
                .accessibilityIdentifier("scanner.preview")
                if case .rejected(let message) = model.state {
                    StatusBanner(tone: .error, title: "That code isn't a Penny invite", message: message)
                }
                Text("Point the camera at the invite QR code on the other person's screen.")
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                typeCodeButton
            }
            .padding(Metrics.gutter)
        case .denied, .unavailable:
            VStack(spacing: 16) {
                PennyStateView(
                    .unavailable,
                    title: model.state == .denied ? "Camera access is off" : "No camera available",
                    message: model.state == .denied
                        ? "You can still type the code. To scan, allow Camera for Penny in Settings."
                        : "This device can't scan. Type the 10-character code instead."
                )
                .accessibilityIdentifier("scanner.denied")
                typeCodeButton
                #if os(iOS)
                    if model.state == .denied, let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("Open Settings", destination: url)
                    }
                #endif
            }
            .padding(Metrics.gutter)
        }
    }

    private var typeCodeButton: some View {
        Button("Type the code instead") { onTypeCode() }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("scanner.typeCode")
    }
}

/// The real camera permission.
struct SystemCameraAccess: CameraAccess {
    func status() -> CameraAccessStatus {
        #if os(iOS)
            guard AVCaptureDevice.default(for: .video) != nil else { return .unavailable }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: return .authorized
            case .notDetermined: return .notDetermined
            case .denied: return .denied
            case .restricted: return .unavailable
            @unknown default: return .denied
            }
        #else
            return .unavailable
        #endif
    }

    func request() async -> Bool {
        #if os(iOS)
            await AVCaptureDevice.requestAccess(for: .video)
        #else
            false
        #endif
    }
}

#if os(iOS)
    /// An AVFoundation camera preview that reports QR payloads. The session runs only while
    /// the view is on screen; nothing is recorded or kept.
    struct CameraPreview: UIViewRepresentable {
        let onCode: (String) -> Void

        func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

        func makeUIView(context: Context) -> PreviewView {
            let view = PreviewView()
            context.coordinator.attach(to: view)
            return view
        }

        func updateUIView(_ view: PreviewView, context: Context) {
            context.coordinator.onCode = onCode
        }

        static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
            coordinator.stop()
        }

        final class PreviewView: UIView {
            override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
            var previewLayer: AVCaptureVideoPreviewLayer? { layer as? AVCaptureVideoPreviewLayer }
        }

        /// The capture session, started and stopped off the main thread as AVFoundation asks.
        final class SessionBox: @unchecked Sendable {
            let session = AVCaptureSession()
        }

        final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
            var onCode: (String) -> Void
            private let box = SessionBox()
            private var session: AVCaptureSession { box.session }
            private let queue = DispatchQueue(label: "penny.invite-scanner")
            private var lastPayload: String?

            init(onCode: @escaping (String) -> Void) {
                self.onCode = onCode
            }

            @MainActor func attach(to view: PreviewView) {
                guard let device = AVCaptureDevice.default(for: .video),
                    let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input)
                else { return }
                session.addInput(input)
                let output = AVCaptureMetadataOutput()
                guard session.canAddOutput(output) else { return }
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
                view.previewLayer?.session = session
                view.previewLayer?.videoGravity = .resizeAspectFill
                let box = box
                queue.async { box.session.startRunning() }
            }

            func stop() {
                let box = box
                queue.async { box.session.stopRunning() }
            }

            func metadataOutput(
                _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
                from connection: AVCaptureConnection
            ) {
                guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
                    let payload = code.stringValue, payload != lastPayload
                else { return }
                lastPayload = payload
                MainActor.assumeIsolated { onCode(payload) }
            }
        }
    }
#else
    struct CameraPreview: View {
        let onCode: (String) -> Void
        var body: some View { Color.black }
    }
#endif
