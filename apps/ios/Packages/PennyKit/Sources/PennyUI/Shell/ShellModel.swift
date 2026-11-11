import Foundation
import PennyData
import PennyDomain
import SwiftUI

/// Who the shell is showing: a signed-in account, or the temporary demo.
enum ShellSession {
    case account(AuthController, SignedInAccount)
    case demo
}

/// The signed-in (or demo) shell's state: navigation, the month on screen, the workspace and
/// the save toast. Shared by the iPhone and iPad layouts through the environment.
@MainActor
@Observable
final class ShellModel {
    var route = ShellRoute()
    var month: MonthKey
    /// The latest save, shown as a toast with Undo until it times out.
    private(set) var toast: SavedChange?
    /// Bumped on every save and every save failure, to drive haptics.
    private(set) var savedCount = 0
    private(set) var failedCount = 0

    let workspace: any LedgerWorkspace
    let session: ShellSession
    let today: CalendarDate
    /// Starts the demo from the empty Home (nil while in the demo).
    let startDemo: (() -> Void)?
    /// Ends the demo and discards everything in it (nil for an account).
    let leaveDemo: (() -> Void)?
    /// What this launch's Expo import needs from the person (MAZ-72), shown in Settings.
    let expoImport: ExpoImportNotice?

    // MARK: Entries and Activity (MAZ-73)

    /// Unsaved entry drafts kept when a form closed without Save or Discard. Every change is
    /// stored through the workspace (per account, on this device), so they survive a relaunch.
    var drafts: EntryDraftShelf {
        get { draftShelf }
        set {
            guard newValue != draftShelf else { return }
            draftShelf = newValue
            workspace.saveDrafts(newValue)
        }
    }
    private var draftShelf: EntryDraftShelf
    /// The entry being edited in the entry form sheet, from Activity or the entry detail.
    var editingEntry: EntryEditRequest?
    /// A route change waiting for the edit sheet to finish closing (`navigate`).
    @ObservationIgnored private var pendingNavigation: ((inout ShellRoute) -> Void)?
    /// The personal entry shown beside the Activity list on iPad (regular width).
    var activitySelection: String?
    /// Activity's filters and query, kept while switching tabs.
    var activityFilters: ActivityFilters
    /// Activity's server search (MAZ-121) for an account; local only in the demo.
    let activitySearch: ActivitySearchModel
    /// Attaches a receipt to an entry draft (MAZ-78 provides it; nil until then).
    var attachReceipt: ((ReceiptSource) async -> Result<ReceiptReference, SaveFailure>)?

    // MARK: Overview (MAZ-77)

    /// The caller's household shares for Home's reports (none in the demo).
    let shared: SharedProjectionModel
    /// The last report built, reused while the ledger and the shared answers are unchanged.
    /// Comparing a ledger that did not change is cheap (arrays share storage), so a large
    /// ledger is joined once per change instead of once per view update.
    @ObservationIgnored private var reportCache: (ledger: Ledger, revision: Int, report: LedgerReport)?

    /// The personal ledger joined with the caller's shared shares: what Home, Insights, the
    /// calendar and the money flow read. Each shared row counts once, as the viewer's share.
    func report(_ ledger: Ledger) -> LedgerReport {
        if let cache = reportCache, cache.revision == shared.revision, cache.ledger == ledger { return cache.report }
        let rows = shared.shares(currency: ledger.currency)
        let report = LedgerReport(ledger: ledger, shared: rows.recorded, sharedScheduled: rows.scheduled)
        reportCache = (ledger, shared.revision, report)
        return report
    }

    /// Reads the shared projection for the month on screen and the one before it (Insights
    /// compares the two).
    func refreshShared() async {
        await shared.refresh(month)
        if let previous = month.shifted(by: -1) { await shared.refresh(previous) }
    }

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    static let toastDuration: Duration = .seconds(4)

    init(
        workspace: any LedgerWorkspace, session: ShellSession, today: CalendarDate,
        startDemo: (() -> Void)? = nil, leaveDemo: (() -> Void)? = nil, search: (any EntrySearchService)? = nil,
        sharedProjection: (any SharedProjectionService)? = nil, expoImport: ExpoImportNotice? = nil
    ) {
        shared = SharedProjectionModel(service: workspace.isDemo ? nil : sharedProjection)
        self.expoImport = expoImport
        self.workspace = workspace
        self.session = session
        self.today = today
        self.startDemo = startDemo
        self.leaveDemo = leaveDemo
        month = MonthKey(today)
        activityFilters = ActivityFilters(period: .month(MonthKey(today)))
        activitySearch = ActivitySearchModel(service: workspace.isDemo ? nil : search)
        draftShelf = workspace.loadDrafts()
    }

    var isDemo: Bool { workspace.isDemo }

    var account: SignedInAccount? {
        if case .account(_, let account) = session { return account }
        return nil
    }

    var auth: AuthController? {
        if case .account(let auth, _) = session { return auth }
        return nil
    }

    var currency: String { workspace.load.ledger?.currency.rawValue ?? Currency.cad.rawValue }

    /// Saves `change`. On success shows the toast (with a success haptic); on failure returns
    /// the failure so the caller keeps the draft and shows it (with an error haptic).
    @discardableResult
    func commit(_ change: LedgerChange, summary: ChangeSummary) async -> SaveFailure? {
        switch await workspace.commit(change, summary: summary) {
        case .success(let saved):
            show(saved)
            return nil
        case .failure(let failure):
            failedCount += 1
            return failure
        }
    }

    func undoToast() async -> SaveFailure? {
        guard let toast else { return nil }
        dismissToast()
        if case .failure(let failure) = await workspace.undo(toast) {
            failedCount += 1
            return failure
        }
        return nil
    }

    /// Changes the route from outside the current screen (a deep link, Edit categories).
    /// SwiftUI cannot present one sheet while another is up or still closing, so when the
    /// change needs a sheet to go first (the edit sheet, or Add entry before Settings opens),
    /// that sheet closes and the change applies once it has gone (`sheetDismissed`).
    func navigate(_ change: @escaping (inout ShellRoute) -> Void) {
        if editingEntry != nil {
            pendingNavigation = change
            editingEntry = nil
            return
        }
        var next = route
        change(&next)
        if route.isAddEntryPresented, !next.isAddEntryPresented, next.isSettingsPresented {
            pendingNavigation = change
            route.isAddEntryPresented = false
            return
        }
        route = next
    }

    /// Called by the edit and Add entry sheets' `onDismiss`: applies a route change that was
    /// waiting for the sheet to go.
    func sheetDismissed() {
        guard let change = pendingNavigation else { return }
        pendingNavigation = nil
        change(&route)
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
    }

    private func show(_ saved: SavedChange) {
        savedCount += 1
        toast = saved
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: Self.toastDuration)
            guard !Task.isCancelled, self?.toast?.id == saved.id else { return }
            self?.toast = nil
        }
    }
}

/// Text for the sync status line in Settings and the iPad sidebar.
enum SyncText {
    static func line(_ status: SyncStatus, now: Date = Date()) -> String {
        switch status {
        case .upToDate(let date?): "Synced \(relative(date, now: now))"
        case .upToDate(nil): "Synced"
        case .syncing(0): "Syncing…"
        case .syncing(let pending): "Syncing \(changes(pending))…"
        case .offline(let pending, _): pending == 0 ? "Offline" : "Offline · \(changes(pending)) waiting"
        case .failing(let pending, _): "Couldn't sync · \(changes(pending)) waiting"
        case .signInRequired(let pending): "Sign in again to sync \(changes(pending))"
        case .localOnly: "Demo · changes are temporary"
        }
    }

    static func changes(_ count: Int) -> String { count == 1 ? "1 change" : "\(count) changes" }

    static func relative(_ date: Date, now: Date) -> String {
        now.timeIntervalSince(date) < 60 ? "just now" : date.formatted(.relative(presentation: .named))
    }

    static func symbol(_ status: SyncStatus) -> String {
        switch status {
        case .upToDate: "checkmark.icloud"
        case .syncing: "arrow.triangle.2.circlepath.icloud"
        case .offline: "icloud.slash"
        case .failing, .signInRequired: "exclamationmark.icloud"
        case .localOnly: "play.circle"
        }
    }
}
