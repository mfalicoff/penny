import Foundation
public import Observation
public import PennyDomain

/// Why Activity searches this device's data instead of the server ("On this device").
public enum DeviceSearchReason: Equatable, Sendable {
    /// The demo searches only its in-memory sample.
    case demo
    /// Changes made here have not reached the server yet; a server page could hide or revive them.
    case pendingChanges
    /// No network.
    case offline
    /// The server has no search v1 (it answered 404).
    case serverWithoutSearch
    /// The server search failed; the message names what happened.
    case serverFailed(String)
}

/// What Activity needs to search the server for one account: the MAZ-121 endpoint through a
/// `SearchCoordinator` (cancellation, stale-generation and account checks) and the offline
/// model's reconciliation (`LedgerSyncModel.reconcile`). A protocol so tests can script it.
@MainActor
public protocol EntrySearchService: AnyObject {
    /// Changes whenever the local ledger or the account changes (a save, a sync).
    var searchEpoch: Int { get }
    /// Why to search this device's data instead of the server, or nil to use the server.
    func deviceReason(serverHasSearch: Bool) -> DeviceSearchReason?
    func reconcile(_ page: SearchPage, startedAt epoch: Int) -> SearchReconciliation
    /// Starts a new search from its first page, cancelling the previous one.
    func search(_ request: SearchRequest) async throws -> SearchPage
    /// The next page of the latest search, or nil when it has none.
    func nextPage() async throws -> SearchPage?
    func cancel() async
}

/// The signed-in account's server search.
@MainActor
public final class AccountEntrySearch: EntrySearchService {
    private let model: LedgerSyncModel
    private let coordinator: SearchCoordinator

    public init(model: LedgerSyncModel, client: APIClient) {
        self.model = model
        coordinator = SearchCoordinator(client: client)
    }

    public var searchEpoch: Int { model.searchEpoch }

    public func deviceReason(serverHasSearch: Bool) -> DeviceSearchReason? {
        if !serverHasSearch { return .serverWithoutSearch }
        if !model.isOnline { return .offline }
        if model.state.hasPendingChanges { return .pendingChanges }
        return nil
    }

    public func reconcile(_ page: SearchPage, startedAt epoch: Int) -> SearchReconciliation {
        model.reconcile(page, startedAt: epoch)
    }

    public func search(_ request: SearchRequest) async throws -> SearchPage { try await coordinator.start(request) }
    public func nextPage() async throws -> SearchPage? { try await coordinator.nextPage() }
    public func cancel() async { await coordinator.cancel() }
}

/// Activity's search state (MAZ-73, docs/migration/search.md "Offline, pending edits and demo").
///
/// Browsing without a query lists this device's ledger. A query goes to the server (search v1:
/// typo and meaning matches, shared expenses) unless changes are pending, the device is
/// offline, the server has no search v1 or this is the demo; then the screen searches this
/// device's data and says so. Local rows are never mixed into server pages.
///
/// Server search is debounced, cancels the previous request, pages with the server's cursor
/// (`loadMore`), and drops any answer that no longer fits: another query or filters, another
/// account, or a save or sync since it started (it searches again). Results are requested in
/// date order so Activity stays chronological and grouped by day.
@MainActor
@Observable
public final class ActivitySearchModel {
    public enum Status: Equatable, Sendable {
        /// No server search: show this device's results (`source` says why when there is a query).
        case idle
        case searching
        case results
        /// The server search failed; the screen shows the message, Retry, and this device's results.
        case failed(String)
    }

    public enum Source: Equatable, Sendable {
        case server
        case device(DeviceSearchReason?)
    }

    public static let pageSize = 50

    public private(set) var status: Status = .idle
    public private(set) var source: Source
    /// The server's rows for `answered`, in the server's order, each key once.
    public private(set) var results: SearchResults?
    /// The filters the current results answer.
    public private(set) var answered: ActivityFilters?
    public private(set) var isLoadingMore = false
    public var hasMore: Bool { results?.hasMore ?? false }
    /// Matching results on the server (not a money total).
    public private(set) var totalCount: Int?

    @ObservationIgnored private let service: (any EntrySearchService)?
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var serverHasSearch = true
    @ObservationIgnored private var current: ActivityFilters?
    @ObservationIgnored private var epoch: Int?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(service: (any EntrySearchService)?, debounce: Duration = .milliseconds(300)) {
        self.service = service
        self.debounce = debounce
        source = .device(service == nil ? .demo : nil)
    }

    isolated deinit { task?.cancel() }

    /// The request a server search sends for `filters`: the trimmed query, the period or day
    /// as dates, the kind, every source, date order. The category is applied to the rows
    /// (search v1 has no category filter).
    public static func request(_ filters: ActivityFilters) -> SearchRequest {
        let range = filters.dateRange
        return SearchRequest(
            query: filters.query.trimmingCharacters(in: .whitespacesAndNewlines), from: range.from?.description,
            to: range.to?.description, kind: filters.kind.map(Self.wireKind), source: .all, sort: .dateDescending,
            pageSize: pageSize)
    }

    /// Shows `filters`. Call it whenever the filters or the service's `searchEpoch` change;
    /// unchanged filters and epoch do nothing.
    public func update(_ filters: ActivityFilters) {
        let epoch = service?.searchEpoch
        guard filters != current || epoch != self.epoch else { return }
        current = filters
        self.epoch = epoch
        start(filters, debounced: true)
    }

    /// Searches again now (the error's Retry, pull to refresh).
    public func retry() {
        guard let current else { return }
        start(current, debounced: false)
    }

    /// The next server page, when there is one. Ignored while one is loading.
    public func loadMore() {
        guard let service, status == .results, hasMore, !isLoadingMore, let filters = current else { return }
        isLoadingMore = true
        let generation = self.generation
        let started = service.searchEpoch
        task = Task { [weak self] in
            do {
                let page = try await service.nextPage()
                guard let self, generation == self.generation, filters == self.current else { return }
                self.isLoadingMore = false
                guard let page else {
                    self.results = self.results.map { results in
                        var copy = results
                        copy.markComplete()
                        return copy
                    }
                    return
                }
                switch service.reconcile(page, startedAt: started) {
                case .show(let page): self.results?.append(page)
                case .searchAgain: self.start(filters, debounced: false)
                case .useLocalResults: self.showDevice(service.deviceReason(serverHasSearch: self.serverHasSearch))
                }
            } catch {
                guard let self, generation == self.generation else { return }
                self.isLoadingMore = false
                if !(error is CancellationError) { self.fail(error) }
            }
        }
    }

    /// Stops any search, for example when the screen goes away.
    public func cancel() {
        generation += 1
        task?.cancel()
        task = nil
        isLoadingMore = false
        // The next `update` starts afresh, even with the same filters.
        current = nil
        epoch = nil
        if status == .searching { status = .idle }
        if let service { Task { await service.cancel() } }
    }

    private func start(_ filters: ActivityFilters, debounced: Bool, attempt: Int = 0) {
        generation += 1
        task?.cancel()
        isLoadingMore = false
        guard let service else {
            showDevice(.demo)
            return
        }
        guard filters.hasQuery else {
            showDevice(nil)
            return
        }
        if let reason = service.deviceReason(serverHasSearch: serverHasSearch) {
            showDevice(reason)
            return
        }
        status = .searching
        source = .server
        let generation = self.generation
        let debounce = self.debounce
        task = Task { [weak self] in
            do {
                if debounced, debounce > .zero { try await Task.sleep(for: debounce) }
                guard let self, generation == self.generation else { return }
                let started = service.searchEpoch
                let page = try await service.search(Self.request(filters))
                guard generation == self.generation, filters == self.current else { return }
                switch service.reconcile(page, startedAt: started) {
                case .show(let page):
                    self.results = SearchResults(first: page)
                    self.totalCount = page.response.totalCount
                    self.answered = filters
                    self.status = .results
                case .searchAgain:
                    // A save or sync landed meanwhile: the page may show a deleted or stale row.
                    if attempt < 3 {
                        self.start(filters, debounced: false, attempt: attempt + 1)
                    } else {
                        self.showDevice(.pendingChanges)
                    }
                case .useLocalResults:
                    self.showDevice(service.deviceReason(serverHasSearch: self.serverHasSearch) ?? .pendingChanges)
                }
            } catch {
                guard let self, generation == self.generation, !(error is CancellationError) else { return }
                self.fail(error)
            }
        }
    }

    private func showDevice(_ reason: DeviceSearchReason?) {
        status = .idle
        source = .device(reason)
        results = nil
        totalCount = nil
        answered = current
    }

    private func fail(_ error: any Error) {
        if case APIError.notFound = error {
            serverHasSearch = false
            showDevice(.serverWithoutSearch)
            return
        }
        let message = Self.message(error)
        results = nil
        totalCount = nil
        answered = current
        source = .device(.serverFailed(message))
        status = .failed(message)
    }

    static func message(_ error: any Error) -> String {
        switch error as? APIError {
        case .offline?: "You're offline. These results are from this device."
        case .timeout?, .unavailable?: "Search took too long on your server. Try again in a moment."
        case .unreachable?: "Penny couldn't reach your server. These results are from this device."
        case .unauthorized?: "Sign in again to search your server."
        case .rateLimited?: "Too many searches at once. Try again in a moment."
        default: "Your server couldn't search right now. These results are from this device."
        }
    }

    static func wireKind(_ kind: EntryKind) -> WireEntryKind {
        switch kind {
        case .expense: .expense
        case .income: .income
        case .investment: .investment
        }
    }
}

extension ActivitySearchModel {
    /// The server rows as report rows for `ledger`: personal entries as the device holds
    /// them when it has the same id (so edits open the current version), shared expenses as
    /// the caller's share, and the category filter applied. Rows that can't be shown (an
    /// unreadable date, another currency) are left out.
    public func rows(in ledger: Ledger) -> (rows: [ReportEntry], report: LedgerReport) {
        guard let results, let filters = answered else { return ([], LedgerReport(ledger: ledger)) }
        var personal: [ReportEntry] = []
        var shared: [SharedExpenseShare] = []
        for item in results.items {
            switch item.payload {
            case .personal(let wire):
                if let entry = ledger.entry(id: wire.id) ?? LedgerEntry(wire: wire) {
                    personal.append(.recorded(entry))
                }
            case .shared(let wire):
                if let share = SharedExpenseShare(wire: wire, currency: ledger.currency) { shared.append(share) }
            }
        }
        // The report adds the shared rows' categories (for icons) and leaves out rows in
        // another currency or out of range.
        let report = LedgerReport(ledger: ledger, shared: shared)
        let sharedRows = report.recorded.filter { $0.source != .personal }
        let rows = (personal + sharedRows).filter { filters.categoryId == nil || $0.categoryId == filters.categoryId }
        return (rows.sorted(by: ReportEntry.chronological), report)
    }
}

extension LedgerEntry {
    /// A personal search result, or nil when its date or kind can't be read.
    init?(wire: WireEntry) {
        guard let date = PennyDomain.CalendarDate(wire.date) else { return nil }
        self.init(
            id: wire.id, title: wire.title, kind: EntryKind(wire: wire.kind), total: wire.total, share: wire.share,
            categoryId: wire.categoryId, accountId: wire.accountId, tripId: wire.tripId, date: date, note: wire.note,
            receipt: wire.receipt.map { ReceiptReference(id: $0.id, name: $0.name, uri: $0.uri, mime: $0.mime) },
            recurringId: wire.recurringId)
    }
}

extension EntryKind {
    init(wire: WireEntryKind) {
        switch wire {
        case .expense: self = .expense
        case .income: self = .income
        case .investment: self = .investment
        }
    }
}

extension SharedExpenseShare {
    /// A shared search result as the caller's share. A household currency the app doesn't
    /// know leaves the row out; a missing one is the ledger's.
    init?(wire: WireProjectedExpense, currency fallback: Currency) {
        guard let date = PennyDomain.CalendarDate(wire.date) else { return nil }
        let currency: Currency
        if let code = wire.householdCurrency {
            guard let known = Currency(rawValue: code) else { return nil }
            currency = known
        } else {
            currency = fallback
        }
        self.init(
            id: wire.id, householdId: wire.householdId, currency: currency, title: wire.title, date: date,
            total: wire.totalCents, share: wire.shareCents,
            category: Category(name: wire.category.name, icon: wire.category.icon, color: wire.category.color),
            note: wire.note, accountId: wire.accountId, recurringId: wire.recurringId,
            scheduled: wire.scheduled ?? false)
    }
}
