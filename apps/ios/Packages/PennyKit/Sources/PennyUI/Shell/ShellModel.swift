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
    var month: MonthKey {
        // The way the month moved, for the slide of its content (MAZ-287): an earlier month
        // enters from the leading edge.
        didSet { if month != oldValue { monthMovedEarlier = month < oldValue } }
    }
    private(set) var monthMovedEarlier = false
    /// The latest save, shown as a toast with Undo until it times out.
    private(set) var toast: SavedChange?
    /// Bumped on every save and every save failure, to drive haptics.
    private(set) var savedCount = 0
    private(set) var failedCount = 0
    /// Bumped when the person's Undo succeeds, and when a Sync now or Retry they asked for ends
    /// (MAZ-287: one haptic per action the person takes; a sync nobody asked for plays none).
    private(set) var undoCount = 0
    private(set) var syncSucceededCount = 0
    private(set) var syncFailedCount = 0
    /// Bumped when the person deletes an entry or changes rows in bulk, for the delete haptic.
    private(set) var deletedCount = 0
    /// Bumped when the person dismisses a schedule suggestion on Recurring (MAZ-290).
    private(set) var dismissedSuggestionCount = 0
    @ObservationIgnored private var syncRequested = false

    let workspace: any LedgerWorkspace
    let session: ShellSession
    /// The person's local date. Income dated after it is expected (MAZ-136), so every report
    /// reads it; `refreshToday()` moves it on at midnight, on a clock or time zone change and
    /// when the app returns to the foreground. The month on screen stays where it is.
    private(set) var today: CalendarDate
    @ObservationIgnored private let clock: () -> CalendarDate
    /// Starts the demo from the empty Home (nil while in the demo).
    let startDemo: (() -> Void)?
    /// Ends the demo and discards everything in it (nil for an account).
    let leaveDemo: (() -> Void)?

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
    /// Receipt upload and download for the signed-in account (MAZ-78); nil in the demo and
    /// previews, where the entry form says receipts need an account.
    var receipts: (any ReceiptTransfers)?
    /// The receipt address and the receipt inbox (MAZ-184). Without a service (the demo,
    /// previews) it shows nothing.
    var receiptInbox = ReceiptInboxModel(service: nil)
    /// Attaches inbox files with the normal saves; nil in the demo and previews.
    var receiptAttacher: ReceiptAttacher?
    /// An inbox file Receipt inbox › New expense opens Add entry with, taken once by the form.
    var addEntryInbox: InboxEntryPrefill?
    /// Writes the Home Screen widgets' snapshot for the signed-in account (MAZ-80); nil in the
    /// demo, previews and tests.
    var widgets: WidgetPublisher?
    /// The current instant ("2 min ago", a month's payment window), from `AppServices.now`.
    @ObservationIgnored var now: () -> Date = { Date() }

    // MARK: Profile (MAZ-171)

    /// The account's name and picture, the name prompt and Settings › Profile. Without a service
    /// (the demo, previews) it shows nothing and the account is named by its email.
    var profile = ProfileModel(service: nil)
    /// Everyone's pictures, loaded once per URL with the account's session.
    var avatars = AvatarStore(fetch: nil)

    /// The account's name: its display name, else its email; "Demo account" in the demo.
    var accountName: String {
        guard let account else { return "Demo account" }
        return profile.displayName ?? account.email
    }

    /// The iPad sidebar's short name (`ipad-*` cards): the first word of the name, else the email.
    var accountShortName: String {
        guard account != nil, let name = profile.displayName else { return accountName }
        return name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? name
    }

    /// The account's picture, else its monogram ("D" in the demo).
    var accountFace: PersonFace {
        guard account != nil else { return PersonFace(initials: "D") }
        return PersonFace(initials: HouseholdPeople.initials(name: accountName), avatarUrl: profile.avatarUrl)
    }

    // MARK: Households (MAZ-75)

    /// The Shared tab's households and their page models (none in the demo).
    let households: HouseholdDirectory
    /// Shared trips and every trip's whole expense list (MAZ-76; none in the demo).
    let trips: TripDirectory
    /// The trip a Trip expense opens Add entry on, taken once by the entry form (MAZ-76).
    var addEntryTripId: String?
    /// The household a page's Expense button opens Add entry on, taken once by the entry form.
    var addEntryHouseholdId: String?
    /// The kind an empty Home's Income, Expense or Invest tile opens Add entry on, taken once by
    /// the entry form.
    var addEntryKind: EntryKind?

    // MARK: Overview (MAZ-77)

    /// The caller's household shares for Home's reports (none in the demo).
    let shared: SharedProjectionModel
    /// The caller's shares for the Activity periods browsed this session (MAZ-185; none in the demo).
    let activityShared: ActivitySharedModel
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
    /// compares the two), the month the recap banner is about (MAZ-292), and the Activity periods
    /// already read, so a shared write shows there.
    func refreshShared() async {
        await shared.refresh(month)
        if let previous = month.shifted(by: -1) { await shared.refresh(previous) }
        if let banner = MonthReview.bannerMonth(today: today), banner != month.shifted(by: -1) {
            await shared.refresh(banner)
        }
        await activityShared.refreshLoaded()
    }

    /// The months a recap reads (MAZ-292): the month, the one before it and the same month a year
    /// earlier, so shared expenses count in all three.
    func refreshRecap(_ recapMonth: MonthKey) async {
        for month in [recapMonth, recapMonth.shifted(by: -1), recapMonth.shifted(by: -12)].compactMap(\.self) {
            await shared.refresh(month)
        }
    }

    // MARK: Monthly recap (MAZ-292)

    /// Dismissed recap banners and the recap notification (device settings; in memory for previews).
    var recap = MonthlyRecap(defaults: nil, center: nil)
    /// Bumped when the person opens the recap, for its haptic. (Dismissing the banner plays its
    /// own, from the banner.)
    private(set) var recapOpenedCount = 0

    /// Opens a month's recap on top of the page on screen (the banner, Insights' Recap button).
    func openRecap(_ month: MonthKey) {
        recapOpenedCount += 1
        route.push(.recap(month: month))
    }

    /// The banner's close button: that month's banner doesn't come back on this device.
    func dismissRecapBanner(_ month: MonthKey) {
        recap.dismiss(month)
    }

    // MARK: Year in review (MAZ-292, phase 2)

    /// The year in review on show in its full-screen cover; nil when closed.
    var yearReview: YearReviewRequest?
    /// Opens a year's review over the screen (the Insights card, the January banner).
    func openYearReview(_ year: Int) {
        recapOpenedCount += 1
        yearReview = YearReviewRequest(year: year)
    }

    /// The January banner's close button: that year's banner doesn't come back on this device.
    func dismissYearReviewBanner(_ year: Int) {
        recap.dismiss(year: year)
    }

    /// The months a year in review reads: all twelve, so shared expenses count in each, and the
    /// households, for the shared trips' and households' names.
    func refreshYear(_ year: Int) async {
        await withTaskGroup(of: Void.self) { group in
            for index in 1...12 {
                guard let month = MonthKey(year: year, month: index) else { continue }
                group.addTask { await self.shared.refresh(month) }
            }
            if households.isAvailable, households.load != .loading {
                group.addTask { await self.households.refresh() }
            }
        }
    }

    /// The person's households as the year in review reads them: shared trips with their range.
    var yearReviewHouseholds: [YearReview.Household] {
        households.households.map { household in
            YearReview.Household(
                id: household.id, memberCount: household.memberCount,
                trip: household.trip.flatMap { trip in
                    guard let start = CalendarDate(trip.startDate), let end = CalendarDate(trip.endDate) else {
                        return nil
                    }
                    return TripRange(start: start, end: end)
                })
        }
    }

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    static let toastDuration: Duration = .seconds(4)

    init(
        workspace: any LedgerWorkspace, session: ShellSession, today: CalendarDate, clock: (() -> CalendarDate)? = nil,
        startDemo: (() -> Void)? = nil, leaveDemo: (() -> Void)? = nil, search: (any EntrySearchService)? = nil,
        sharedProjection: (any SharedProjectionService)? = nil,
        households householdService: (any HouseholdService)? = nil, householdEmail: String? = nil
    ) {
        let monthClock = clock ?? { today }
        var email = householdEmail ?? ""
        if case .account(_, let account) = session { email = householdEmail ?? account.email }
        households = HouseholdDirectory(
            service: workspace.isDemo ? nil : householdService, email: email, month: { MonthKey(monthClock()) })
        trips = TripDirectory(households: households)
        shared = SharedProjectionModel(service: workspace.isDemo ? nil : sharedProjection)
        activityShared = ActivitySharedModel(service: workspace.isDemo ? nil : sharedProjection)
        self.workspace = workspace
        self.session = session
        self.today = today
        self.clock = clock ?? { today }
        self.startDemo = startDemo
        self.leaveDemo = leaveDemo
        month = MonthKey(today)
        activityFilters = ActivityFilters(period: .month(MonthKey(today)))
        activitySearch = ActivitySearchModel(service: workspace.isDemo ? nil : search)
        draftShelf = workspace.loadDrafts()
    }

    var isDemo: Bool { workspace.isDemo }

    /// Reads the date again from the clock. Changes `today` only when the day changed, so a
    /// foreground on the same day redraws nothing; income dated on the new day moves from
    /// expected to Left to spend (MAZ-136).
    func refreshToday() {
        let now = clock()
        if now != today { today = now }
    }

    /// Refreshes `today` on every calendar day change (midnight, a clock or time zone change:
    /// the signal `LedgerSyncModel` materializes recurrence on) until the task is cancelled.
    func followDayChanges(_ monitor: any CalendarDayMonitoring = SystemCalendarDayMonitor()) async {
        refreshToday()
        for await _ in monitor.dayChanges() { refreshToday() }
    }

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
    func commit(
        _ change: LedgerChange, summary: ChangeSummary, deleting: Bool = false, dismissing: Bool = false
    ) async -> SaveFailure? {
        switch await workspace.commit(change, summary: summary) {
        case .success(let saved):
            // A delete plays the delete haptic instead of the save one (MAZ-287), and dismissing a
            // suggestion a light one (MAZ-290).
            if deleting { deletedCount += 1 }
            if dismissing { dismissedSuggestionCount += 1 }
            show(saved, haptic: !deleting && !dismissing)
            return nil
        case .failure(let failure):
            failedCount += 1
            return failure
        }
    }

    /// Trip expense on a personal trip (MAZ-76): Add entry, opened on that trip.
    func openTripExpense(_ tripId: String) {
        addEntryTripId = tripId
        navigate { $0.openAddEntry() }
    }

    /// Receipt inbox › New expense: Add entry as an expense dated the day the email arrived,
    /// titled with the sender, with the receipt attached (MAZ-184).
    func openInboxExpense(_ prefill: InboxEntryPrefill) {
        addEntryInbox = prefill
        navigate { $0.openAddEntry() }
    }

    /// Set by iPad Home's search button; Activity focuses its search field and clears it.
    var activitySearchRequested = false

    /// iPad Home's search button (`ipad-home` card): Activity, with its search field focused.
    func openActivitySearch() {
        activitySearchRequested = true
        navigate { $0.select(.activity) }
    }

    /// The empty Home's Income, Expense and Invest tiles: Add entry, opened on that kind.
    func openAddEntry(kind: EntryKind) {
        addEntryKind = kind
        navigate { $0.openAddEntry() }
    }

    /// A household's (or shared trip's) Expense button: Add entry, opened with that household
    /// chosen, so a shared expense is added in the same form as any other entry.
    func openSharedExpense(_ householdId: String) {
        addEntryHouseholdId = householdId
        navigate { $0.openAddEntry() }
    }

    func undoToast() async -> SaveFailure? {
        guard let toast, toast.canUndo else { return nil }
        dismissToast()
        if case .failure(let failure) = await workspace.undo(toast) {
            failedCount += 1
            return failure
        }
        undoCount += 1
        return nil
    }

    /// Sync now and Retry: syncs, and plays the success or error haptic when that sync ends.
    func syncNow() async {
        syncRequested = true
        await workspace.syncNow()
    }

    /// Ends a sync the person asked for once its status settles; other changes play nothing.
    func syncChanged(to status: SyncStatus) {
        guard syncRequested else { return }
        switch status {
        case .syncing: return
        case .upToDate, .localOnly: syncSucceededCount += 1
        case .offline, .failing, .signInRequired: syncFailedCount += 1
        }
        syncRequested = false
    }

    /// The person deleted an entry (after its confirmation) or changed rows in bulk.
    func didDelete() { deletedCount += 1 }

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
        if Self.closesSheet(from: route, to: next) { sheetsClosing += 1 }
        route = next
    }

    /// Closes the join sheet and applies `change` once it has gone (its `onDismiss` calls
    /// `sheetDismissed`), so the next sheet or column never changes in the same update.
    func closeHouseholdStart(then change: @escaping (inout ShellRoute) -> Void) {
        guard route.householdStart != nil else { return navigate(change) }
        pendingNavigation = change
        sheetsClosing += 1
        route.householdStart = nil
    }

    /// Called by the sheets' `onDismiss`: applies a route change that was waiting for the sheet
    /// to go, then presents a join sheet a link asked for meanwhile.
    func sheetDismissed() {
        sheetsClosing = max(0, sheetsClosing - 1)
        if let change = pendingNavigation {
            pendingNavigation = nil
            change(&route)
        }
        presentPendingHouseholdStart()
    }

    /// Sheets closing right now (between a route change and their `onDismiss`). A join sheet
    /// waits for them (`ShellRoute.pendingHouseholdStart`).
    @ObservationIgnored private(set) var sheetsClosing = 0

    /// Presents the join sheet a link asked for, once the Shared tab is on screen (it calls
    /// this when it appears and when a link arrives) and no other sheet is still closing.
    func presentPendingHouseholdStart(force: Bool = false) {
        guard sheetsClosing == 0 || force, route.pendingHouseholdStart != nil else { return }
        if force { sheetsClosing = 0 }
        route.presentPendingHouseholdStart()
    }

    /// Whether going from `old` to `new` dismisses a sheet (not the iPad Settings column).
    static func closesSheet(from old: ShellRoute, to new: ShellRoute) -> Bool {
        (old.isAddEntryPresented && !new.isAddEntryPresented)
            || (old.householdStart != nil && new.householdStart == nil)
            || (old.isCalendarPresented && !new.isCalendarPresented)
            || (old.isSettingsPresented && !new.isSettingsPresented && !old.settingsIsColumn)
    }

    /// Shows the save toast for a change that went to the server and has no Undo (a shared
    /// expense saved without its cleaned-up receipt, MAZ-199).
    func notify(_ title: String, detail: String) {
        show(SavedChange(summary: ChangeSummary(title: title, detail: detail, allowsUndo: false), canUndo: false))
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
    }

    private func show(_ saved: SavedChange, haptic: Bool = true) {
        if haptic { savedCount += 1 }
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

/// What Receipt inbox › New expense starts Add entry with.
struct InboxEntryPrefill: Equatable {
    var title: String
    var date: CalendarDate
    var receipt: ReceiptReference
}

/// The year in review shown in its full-screen cover (MAZ-292, phase 2).
struct YearReviewRequest: Identifiable, Hashable {
    let year: Int
    var id: Int { year }
}
