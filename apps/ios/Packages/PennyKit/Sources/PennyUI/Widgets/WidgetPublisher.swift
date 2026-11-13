public import Foundation
public import PennyData
public import PennyDomain
import SwiftUI
import WidgetKit

/// Keeps the Home Screen widgets' snapshot in step with the signed-in account (MAZ-80,
/// docs/ios-widgets.md). The app is the only writer of the App Group snapshot:
///
/// - the account's shell publishes a new snapshot whenever what the widgets show changes (a
///   saved, synced or undone change, shared rows arriving, a new day, the sync state);
/// - sign-out, an expired session and switching to another account clear it before the new
///   state is on screen, so a widget never shows the previous account's money;
/// - every write or removal reloads the widgets' timelines.
///
/// The demo never publishes: its sample data is not the person's.
@MainActor
public final class WidgetPublisher {
    /// Who the widgets belong to now, from the auth state.
    public enum Owner: Equatable, Sendable {
        /// Signed out (or signing in): nothing may be shown.
        case nobody
        case account(String)
        /// Restoring or waiting for the Keychain: keep what is there until it is known.
        case unknown
    }

    /// How old an unchanged snapshot may get before the app stamps it again.
    static let restampAfter: TimeInterval = 60 * 60

    private let store: WidgetSnapshotStore
    private let reload: () -> Void
    private let now: () -> Date
    /// Who owns the widgets, as last told. `.unknown` until the auth state is known.
    public private(set) var owner: Owner = .unknown
    /// The last snapshot written for `owner`, so unchanged content is not rewritten.
    private var written: WidgetSnapshot?
    /// A snapshot published while signed out, written only if that account signs in next.
    private var waiting: (owner: String, snapshot: WidgetSnapshot)?

    public init(
        store: WidgetSnapshotStore, now: @escaping () -> Date = Date.init,
        reload: (() -> Void)? = nil
    ) {
        self.store = store
        self.now = now
        // Both widgets read the same file, so every kind reloads.
        self.reload = reload ?? { WidgetCenter.shared.reloadAllTimelines() }
    }

    /// The publisher for the App Group, or nil when this build lacks the entitlement (then
    /// nothing is written anywhere: never the app's private container).
    public static func live(appGroup: String = AppIdentity.appGroup) -> WidgetPublisher? {
        guard let container = try? SharedContainer(appGroup: appGroup) else { return nil }
        return WidgetPublisher(store: WidgetSnapshotStore(container: container))
    }

    /// The signed-in account changed (or signed out). `.unknown` keeps what is stored.
    public func ownerChanged(_ next: Owner) {
        guard next != .unknown, next != owner else { return }
        owner = next
        switch next {
        case .unknown:
            return
        case .nobody:
            written = nil
            waiting = nil
            if store.clear() { reload() }
        case .account(let id):
            written = store.snapshot(for: id)
            if store.clear(unlessOwnedBy: id) { reload() }
            let pending = waiting
            waiting = nil
            if let pending, pending.owner == id { publish(pending.snapshot, owner: id) }
        }
    }

    /// Writes `snapshot` for the account `owner` when its content changed. The account's shell
    /// may publish before the auth change reaches `ownerChanged`, so a new account is adopted
    /// here too (clearing another account's file first). Ignored once signed out: a late update
    /// from a shell that is going away never brings money back; it is kept only in case the
    /// same account's sign-in arrives next (a new shell publishing before `ownerChanged`).
    public func publish(_ snapshot: WidgetSnapshot, owner id: String) {
        if owner == .nobody {
            waiting = (id, snapshot)
            return
        }
        ownerChanged(.account(id))
        guard owner == .account(id) else { return }
        let owner = id
        // Unchanged content is rewritten only to restamp an old snapshot, so a widget doesn't
        // say "Updated 1 day ago" right after the app confirmed the numbers.
        if let written, written.sameContent(as: snapshot),
            now().timeIntervalSince(written.generatedAt) < Self.restampAfter
        {
            return
        }
        var stamped = snapshot
        stamped.generatedAt = now()
        do {
            try store.write(stamped, owner: owner)
            written = stamped
            reload()
        } catch {
            // Nothing else to do: the widget keeps its previous snapshot and the next change
            // tries again. The ledger itself is unaffected.
            written = nil
        }
    }

    /// Who owns the widgets in `state`.
    public static func owner(_ state: AuthState) -> Owner {
        switch state {
        case .signedOut, .signingIn: .nobody
        case .signedIn(let account), .signingOut(let account): .account(WidgetSnapshotStore.owner(account.scope))
        case .restoring, .keychainUnavailable: .unknown
        }
    }
}

extension ShellModel {
    /// What the widgets would show now, or nil when it isn't known yet: the ledger is still
    /// loading, or this month's shared rows haven't answered the first time (publishing then
    /// would briefly leave the household shares out of Left to spend).
    var widgetSnapshot: WidgetSnapshot? {
        guard !isDemo, let ledger = workspace.load.ledger else { return nil }
        let month = MonthKey(today)
        if shared.isAvailable, shared.answers[month] == nil {
            switch shared.status(for: month) {
            case .idle, .loading: return nil
            case .loaded, .failed: break
            }
        }
        let sync = workspace.sync
        return WidgetSnapshot(
            report: report(ledger), currency: ledger.currency, today: today, now: .distantPast,
            waitingToSync: sync.needsAttention && sync.pending > 0)
    }
}

/// Publishes the account shell's widget snapshot whenever it changes.
struct WidgetPublishing: ViewModifier {
    let shell: ShellModel

    func body(content: Content) -> some View {
        content
            .onChange(of: shell.widgetSnapshot, initial: true) { _, snapshot in
                guard let snapshot, let account = shell.account else { return }
                shell.widgets?.publish(snapshot, owner: WidgetSnapshotStore.owner(account.scope))
            }
            .task(id: MonthKey(shell.today)) {
                // Home asks for the month on screen; the widgets need today's month even when
                // another month is on screen.
                if shell.widgets != nil { await shell.shared.refresh(MonthKey(shell.today)) }
            }
    }
}
