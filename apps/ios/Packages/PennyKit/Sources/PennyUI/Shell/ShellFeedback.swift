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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let status = shell.workspace.sync
        if case .offline(let pending, _) = status {
            OfflineCapsule(pending: pending, message: Self.message(status) ?? "") {
                Task { await shell.syncNow() }
            }
            .accessibilityIdentifier("banner.sync")
            .transition(Motion.transition(edge: .top, reduceMotion: reduceMotion))
        } else if status.needsAttention {
            StatusBanner(tone: tone(status), title: Self.title(status), message: Self.message(status)) {
                if case .signInRequired = status {
                    EmptyView()
                } else {
                    InlineActionButton("Retry") { Task { await shell.syncNow() } }
                }
            }
            .accessibilityIdentifier("banner.sync")
            .transition(Motion.transition(edge: .top, reduceMotion: reduceMotion))
        }
    }

    /// Amber, as on the `sync-failed` card: the changes are kept on the device and only wait to
    /// upload, so it isn't a red error.
    private func tone(_ status: SyncStatus) -> BannerTone {
        if case .offline = status { return .offline }
        return .warning
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

/// The offline banner (`offline` card): one line on a glass capsule, "**Offline** · 2 changes
/// waiting", and Retry. It is a control over the page, so it is glass (opaque with Reduce
/// Transparency). VoiceOver also hears that nothing is lost, which the line leaves out.
struct OfflineCapsule: View {
    let pending: Int
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "icloud.slash")
                .font(.body.weight(.semibold))
                .foregroundStyle(PennyColor.pending)
                .accessibilityHidden(true)
            Text("\(Text("Offline").fontWeight(.semibold))\(Self.detail(pending))")
                .font(.subheadline)
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("\(SyncBanner.title(.offline(pending: pending, lastSynced: nil))). \(message)")
            Spacer(minLength: 8)
            Button("Retry", action: retry)
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(minHeight: 48)
        .pennyGlass(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    /// " · 2 changes waiting" after "Offline", or nothing when nothing waits.
    static func detail(_ pending: Int) -> String {
        pending == 0 ? "" : " · \(SyncText.changes(pending)) waiting"
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

/// The save toast over the shell, with Undo, and the shell's haptics: one per action the person
/// takes (save, failure, undo, delete, sync, month step, opening an entry beside Activity; MAZ-287).
/// VoiceOver announces the toast.
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
                    .transition(Motion.transition(edge: .bottom, reduceMotion: reduceMotion))
                    .accessibilityIdentifier("toast.saved")
                    .onAppear { announce("\(toast.summary.title). \(toast.detail ?? "")") }
                }
            }
            .animation(Motion.animation(.standard, reduceMotion: reduceMotion), value: shell.toast?.id)
            // One haptic per action the person takes (docs/design/motion.md#haptics-ios).
            .pennyHaptic(.save, trigger: shell.savedCount)
            .pennyHaptic(.failed, trigger: shell.failedCount)
            .pennyHaptic(.undo, trigger: shell.undoCount)
            .pennyHaptic(.delete, trigger: shell.deletedCount)
            .pennyHaptic(.syncSucceeded, trigger: shell.syncSucceededCount)
            .pennyHaptic(.syncFailed, trigger: shell.syncFailedCount)
            .pennyHaptic(.stepPeriod, trigger: shell.month)
            // The recap (MAZ-292), opened from its banner or Insights' Recap button.
            .pennyHaptic(.openRecap, trigger: shell.recapOpenedCount)
            // Add entry opening or closing.
            .pennyHaptic(.openClose, trigger: shell.route.isAddEntryPresented)
            // An entry opened in the iPad detail column beside Activity.
            .pennyHaptic(.open, trigger: shell.activitySelection) { _, new in new != nil }
            .onChange(of: shell.workspace.sync) { _, status in shell.syncChanged(to: status) }
            .alert(
                "Couldn't undo",
                isPresented: Binding(get: { undoFailure != nil }, set: { if !$0 { undoFailure = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(undoFailure ?? "")
            }
    }

    /// The card's round tile (`.toast .ic`): the entry's own tile color and symbol (the category's
    /// for an expense, green for income, indigo for an investment); a copper check otherwise.
    private func leading(_ summary: ChangeSummary) -> AnyView? {
        guard let kind = summary.kind else {
            return AnyView(Self.tile(symbol: "checkmark", color: PennyColor.tint))
        }
        let categoryId = summary.categoryId ?? ""
        let category = shell.workspace.load.ledger?.category(id: categoryId)
        return AnyView(
            Self.tile(
                symbol: EntryText.tileSymbol(kind, category: category),
                color: EntryText.tileColor(kind, category: category, id: categoryId)))
    }

    private static func tile(symbol: String, color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(color, in: Circle())
            .accessibilityHidden(true)
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
