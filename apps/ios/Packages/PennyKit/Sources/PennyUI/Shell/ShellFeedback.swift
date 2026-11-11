import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The offline / sync-error banner over Home and Activity. It names how many changes wait
/// and offers Retry; nothing is lost while it shows.
struct SyncBanner: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let status = shell.workspace.sync
        if status.needsAttention {
            StatusBanner(tone: tone(status), title: Self.title(status), message: Self.message(status)) {
                if case .signInRequired = status {
                    EmptyView()
                } else {
                    InlineActionButton("Retry") { Task { await shell.workspace.syncNow() } }
                }
            }
            .accessibilityIdentifier("banner.sync")
        }
    }

    private func tone(_ status: SyncStatus) -> BannerTone {
        if case .offline = status { return .offline }
        return .error
    }

    /// "iPad" on iPad, otherwise "iPhone" (the only idioms the app runs on).
    @MainActor static var deviceName: String {
        #if os(iOS)
            UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
            "device"
        #endif
    }

    static func title(_ status: SyncStatus) -> String {
        switch status {
        case .offline(let pending, _):
            pending == 0 ? "Offline" : "Offline · \(SyncText.changes(pending)) waiting"
        case .failing(let pending, _): "Couldn't sync · \(SyncText.changes(pending)) waiting"
        case .signInRequired(let pending): "Sign in to sync \(SyncText.changes(pending))"
        case .upToDate, .syncing, .localOnly: ""
        }
    }

    static func message(_ status: SyncStatus, device: String = deviceName) -> String? {
        switch status {
        case .offline: "Your changes are saved on this \(device) and sync when you're back online."
        case .failing(_, let problem): problem.message
        case .signInRequired: "Your changes stay on this device until you sign in again."
        case .upToDate, .syncing, .localOnly: nil
        }
    }
}

/// "Demo · Changes are temporary", with Leave demo. Shown on every root screen in the demo.
struct DemoBanner: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        if shell.isDemo {
            StatusBanner(
                tone: .demo, title: "Demo · Changes are temporary",
                message: "Sample data only. Nothing is saved or sent to a server."
            ) {
                if let leave = shell.leaveDemo { InlineActionButton("Leave", action: leave) }
            }
            .accessibilityIdentifier("banner.demo")
        }
    }
}

/// The save toast over the shell, with Undo, a success haptic, and an error haptic when a
/// save fails. VoiceOver announces it.
struct ToastOverlay: ViewModifier {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let bottomPadding: Double
    @State private var undoFailure: String?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let toast = shell.toast {
                    SaveToast(
                        title: toast.summary.title, detail: toast.detail, leading: leading(toast.summary),
                        undo: toast.canUndo ? { Task { undoFailure = await shell.undoToast()?.message } } : nil
                    )
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.bottom, bottomPadding)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    .accessibilityIdentifier("toast.saved")
                    .onAppear { announce("\(toast.summary.title). \(toast.detail ?? "")") }
                }
            }
            .animation(reduceMotion ? nil : .snappy, value: shell.toast?.id)
            .sensoryFeedback(.success, trigger: shell.savedCount)
            .sensoryFeedback(.error, trigger: shell.failedCount)
            .alert(
                "Couldn't undo",
                isPresented: Binding(get: { undoFailure != nil }, set: { if !$0 { undoFailure = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(undoFailure ?? "")
            }
    }

    private func leading(_ summary: ChangeSummary) -> AnyView? {
        guard let kind = summary.kind else {
            return AnyView(CategoryIcon(symbol: "checkmark", color: PennyColor.tint, size: 32))
        }
        let symbol: String =
            switch kind {
            case .expense: "arrow.up"
            case .income: "arrow.down"
            case .investment: "chart.line.uptrend.xyaxis"
            }
        return AnyView(CategoryIcon(symbol: symbol, color: PennyColor.tint, size: 32))
    }

    private func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

/// The save-error state of a form (`save-error` card): the draft stays, the reason and the
/// next step are named, and Try again repeats the save.
struct SaveErrorBanner: View {
    let failure: SaveFailure
    let retry: (() -> Void)?

    var body: some View {
        StatusBanner(tone: .error, title: "Couldn't save", message: failure.message) {
            if let retry { InlineActionButton("Try again", action: retry) }
        }
        .accessibilityIdentifier("banner.saveError")
    }
}
