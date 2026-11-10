import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Activity (`activity`, `activity-expenses`, `search-empty` cards; MAZ-73): recorded entries
/// grouped by day with each day's net, the period's totals, kind and category chips, a filters
/// sheet (month, year or all time, one day, type, category), and the system search field.
///
/// Browsing lists this device's ledger. A query searches the server (MAZ-121: typo and meaning
/// matches, shared expenses) in date order, with paging; with pending changes, offline, against
/// a server without search or in the demo it searches this device's data with the shared
/// normalization and says so. Rows open the entry; swipe for Edit and Delete (confirmed).
struct ActivityView: View {
    @Environment(ShellModel.self) private var shell
    @State private var filtersPresented = false

    var body: some View {
        @Bindable var shell = shell
        WorkspaceContent { ledger in
            ActivityList(ledger: ledger, showFilters: { filtersPresented = true })
        }
        .background(PennyColor.background)
        .navigationTitle("Activity")
        .searchable(text: $shell.activityFilters.query, prompt: "Search activity")
        .toolbar {
            if case .month = shell.activityFilters.period {
                ToolbarItem(placement: .navigation) { MonthPicker() }
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Filters", systemImage: "line.3.horizontal.decrease") { filtersPresented = true }
                    .accessibilityIdentifier("activity.filters")
            }
        }
        .sheet(isPresented: $filtersPresented) {
            ActivityFiltersSheet().environment(shell)
        }
        .onChange(of: shell.month) {
            if case .month = shell.activityFilters.period { shell.activityFilters.period = .month(shell.month) }
        }
        .onChange(of: shell.activityFilters.period) {
            if case .month(let month) = shell.activityFilters.period, month != shell.month { shell.month = month }
        }
        .accessibilityIdentifier("screen.activity")
    }
}

/// Local results for the current ledger and filters, recomputed only when either changes.
/// The search index (normalizing every row) is built only once there is a query.
@MainActor
final class ActivityLocalCache {
    private var ledger: Ledger?
    private(set) var report = LedgerReport(ledger: Ledger())
    private var index: FoldedSearchIndex?
    private var filters: ActivityFilters?
    private var result: ActivityResult?

    func result(_ ledger: Ledger, _ filters: ActivityFilters) -> ActivityResult {
        if ledger != self.ledger {
            self.ledger = ledger
            report = LedgerReport(ledger: ledger)
            index = nil
            result = nil
        }
        if let result, filters == self.filters { return result }
        if filters.hasQuery, index == nil { index = FoldedSearchIndex(report) }
        let next = report.activity(filters, index: index ?? FoldedSearchIndex())
        self.filters = filters
        result = next
        return next
    }
}

private struct ActivityList: View {
    @Environment(ShellModel.self) private var shell
    let ledger: Ledger
    let showFilters: () -> Void
    @State private var cache = ActivityLocalCache()
    /// Local rows drawn so far; more appear as the list nears its end (100,000-entry ledgers).
    @State private var visibleLimit = ActivityList.pageSize
    @State private var deleting: LedgerEntry?

    static let pageSize = 200

    var body: some View {
        @Bindable var shell = shell
        let filters = shell.activityFilters
        let search = shell.activitySearch
        let local = cache.result(ledger, filters)
        let server = Self.showsServer(search, filters: filters) ? search.rows(in: ledger) : nil
        let report = server?.report ?? cache.report
        let rows = server?.rows ?? local.entries
        let shown = server == nil ? Array(rows.prefix(visibleLimit)) : rows
        let days = ActivityDay.group(shown)
        let currency = ledger.currency.rawValue
        List {
            Section {
                SyncBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                DemoBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                ActivityChips(filters: $shell.activityFilters, ledger: ledger, showFilters: showFilters)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                ActivityTotals(summary: local.summary, currency: currency)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                    .listRowBackground(Color.clear)
                if filters.hasQuery {
                    ActivitySearchScope(search: search, filters: filters)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
            }
            .listSectionSeparator(.hidden)
            ForEach(days, id: \.date) { day in
                Section {
                    ForEach(day.entries) { entry in
                        row(entry, report: report, currency: currency, isLast: entry.id == shown.last?.id)
                    }
                } header: {
                    ActivityDayHeader(day: day.date, net: day.net, currency: currency)
                }
            }
            footer(rows: rows, shown: shown, search: search, server: server != nil)
        }
        .insetGroupedList()
        .overlay { emptyState(rows: rows, search: search, filters: filters) }
        .refreshable {
            await shell.workspace.reload()
            search.retry()
        }
        .onChange(of: filters, initial: true) {
            visibleLimit = Self.pageSize
            search.update(filters)
        }
        .onChange(of: ledger) { search.update(filters) }
        .deleteEntryConfirmation($deleting)
    }

    static func showsServer(_ search: ActivitySearchModel, filters: ActivityFilters) -> Bool {
        search.source == .server && search.status == .results && search.answered == filters
    }

    @ViewBuilder
    private func row(_ entry: ReportEntry, report: LedgerReport, currency: String, isLast: Bool) -> some View {
        let personal = entry.source == .personal ? ledger.entry(id: entry.id) : nil
        NavigationLink(value: ActivityRoute.destination(entry)) {
            EntryRow(entry: entry, report: report, currency: currency)
        }
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 12))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if let personal {
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = personal }
                    .accessibilityIdentifier("activity.delete")
                Button("Edit", systemImage: "square.and.pencil") { shell.edit(personal) }
                    .tint(PennyColor.secondaryLabel)
                    .accessibilityIdentifier("activity.edit")
            }
        }
        .contextMenu {
            if let personal {
                Button("Edit", systemImage: "square.and.pencil") { shell.edit(personal) }
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = personal }
            }
        }
        .onAppear {
            if isLast { shell.activitySearch.loadMore() }
        }
    }

    @ViewBuilder
    private func footer(rows: [ReportEntry], shown: [ReportEntry], search: ActivitySearchModel, server: Bool)
        -> some View
    {
        if server, search.hasMore {
            Section {
                HStack {
                    Spacer()
                    if search.isLoadingMore {
                        ProgressView("Loading more…")
                    } else {
                        Button("Load more results") { search.loadMore() }
                            .accessibilityIdentifier("activity.loadMore")
                    }
                    Spacer()
                }
            }
        } else if !server, rows.count > shown.count {
            Section {
                Button("Show \(min(Self.pageSize, rows.count - shown.count)) more") {
                    visibleLimit += Self.pageSize
                }
                .frame(maxWidth: .infinity)
                .onAppear { visibleLimit += Self.pageSize }
                .accessibilityIdentifier("activity.showMore")
            }
        }
    }

    @ViewBuilder
    private func emptyState(rows: [ReportEntry], search: ActivitySearchModel, filters: ActivityFilters) -> some View {
        if rows.isEmpty {
            if filters.hasQuery, search.status == .searching {
                PennyStateView(.loading, title: "Searching your server…")
                    .accessibilityIdentifier("activity.searching")
            } else if filters.hasQuery || filters.isNarrowed {
                ActivitySearchEmpty(filters: filters)
            } else {
                PennyStateView(
                    .empty, title: "No entries in \(ActivityPeriodText.title(filters.period))",
                    message: "Entries you add show up here, grouped by day.", actionTitle: "Add entry"
                ) { shell.route.openAddEntry() }
            }
        }
    }
}

/// "No results for “sushi”" (`search-empty` card), with Search all months and Clear filters.
private struct ActivitySearchEmpty: View {
    @Environment(ShellModel.self) private var shell
    let filters: ActivityFilters

    var body: some View {
        let trimmed = filters.query.trimmingCharacters(in: .whitespacesAndNewlines)
        ContentUnavailableView {
            Label(trimmed.isEmpty ? "Nothing matches" : "No results for “\(trimmed)”", systemImage: "magnifyingglass")
        } description: {
            Text("Nothing matches in \(ActivityPeriodText.scope(filters)). Try another word, or search everything.")
        } actions: {
            if filters.period != .allTime || filters.day != nil {
                Button("Search all months") {
                    shell.activityFilters.period = .allTime
                    shell.activityFilters.day = nil
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("activity.searchAllMonths")
            }
            if filters.isNarrowed {
                Button("Clear filters") { shell.activityFilters.clearNarrowing() }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("activity.clearFilters")
            }
        }
        .accessibilityIdentifier("activity.searchEmpty")
    }
}

/// Where the results come from: the server, or this device and why, with what that leaves out.
private struct ActivitySearchScope: View {
    let search: ActivitySearchModel
    let filters: ActivityFilters

    var body: some View {
        switch search.source {
        case .server:
            if search.status == .results, let count = search.totalCount {
                Label(
                    "\(count == 1 ? "1 result" : "\(count) results") from your server, including similar words and meanings",
                    systemImage: "server.rack"
                )
                .font(.footnote)
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityIdentifier("activity.scope.server")
            } else if search.status == .searching {
                Label("Searching your server…", systemImage: "magnifyingglass")
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
        case .device(.serverFailed(let message)?):
            StatusBanner(tone: .error, title: "Couldn't search your server", message: message) {
                InlineActionButton("Retry") { search.retry() }
                    .accessibilityIdentifier("activity.searchRetry")
            }
            .accessibilityIdentifier("activity.searchError")
        case .device(let reason):
            Label(Self.deviceText(reason), systemImage: "iphone")
                .font(.footnote)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("activity.scope.device")
        }
    }

    static func deviceText(_ reason: DeviceSearchReason?) -> String {
        let words = "Matching words only; similar words, meanings and shared expenses need your server."
        switch reason {
        case .demo?: return "Searching the demo's sample data on this device."
        case .pendingChanges?: return "On this device: your latest changes haven't synced yet. \(words)"
        case .offline?: return "On this device: you're offline. \(words)"
        case .serverWithoutSearch?: return "On this device: your server doesn't offer search yet. \(words)"
        case .serverFailed?, nil: return "On this device. \(words)"
        }
    }
}

/// All / Expenses / Income / Investments, the period (opens Filters), and the category chips
/// of the chosen kind with All categories.
private struct ActivityChips: View {
    @Binding var filters: ActivityFilters
    let ledger: Ledger
    let showFilters: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    kindChip("All", nil)
                    kindChip("Expenses", .expense)
                    kindChip("Income", .income)
                    kindChip("Investments", .investment)
                    ActivityChip(
                        title: filters.day.map { DayText.date($0).formatted(.dateTime.month(.abbreviated).day()) }
                            ?? ActivityPeriodText.title(filters.period),
                        systemImage: "calendar", selected: filters.day != nil || filters.period == .allTime,
                        action: showFilters
                    )
                    .accessibilityIdentifier("activity.period")
                }
                .padding(.vertical, 4)
            }
            if let kind = filters.kind {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ActivityChip(title: "All categories", selected: filters.categoryId == nil) {
                            filters.categoryId = nil
                        }
                        .accessibilityIdentifier("activity.category.all")
                        ForEach(Self.categories(kind, selection: filters.categoryId, ledger: ledger), id: \.id) {
                            category in
                            ActivityChip(
                                title: category.name, systemImage: EntryText.symbol(category),
                                selected: filters.categoryId == category.id
                            ) { filters.categoryId = filters.categoryId == category.id ? nil : category.id }
                            .accessibilityIdentifier("activity.category.\(category.id)")
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filters")
    }

    /// The four most used categories of `kind`, plus the selected one.
    static func categories(_ kind: EntryKind, selection: String?, ledger: Ledger) -> [LedgerCategory] {
        var result = Array(ledger.categoriesByUse(kind).prefix(4))
        if let selection, !result.contains(where: { $0.id == selection }), let selected = ledger.category(id: selection)
        {
            result.append(selected)
        }
        return result
    }

    private func kindChip(_ title: String, _ value: EntryKind?) -> some View {
        ActivityChip(title: title, selected: filters.kind == value) { filters.kind = value }
            .accessibilityIdentifier("activity.filter.\(value?.rawValue ?? "all")")
    }
}

struct ActivityChip: View {
    let title: String
    var systemImage: String?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).accessibilityHidden(true) }
                Text(title)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: Metrics.minTouchTarget)
            .foregroundStyle(selected ? PennyColor.background : PennyColor.label)
            .background(selected ? PennyColor.label : PennyColor.fill, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The period's totals (your shares). Filters and search never change them.
private struct ActivityTotals: View {
    let summary: KindTotals
    let currency: String

    var body: some View {
        let parts = [
            "Spent \(MoneyFormat.amount(summary.expense, currency: currency))",
            "Came in \(MoneyFormat.amount(summary.income, currency: currency))",
            "Invested \(MoneyFormat.amount(summary.investment, currency: currency))",
        ]
        Text(parts.joined(separator: " · "))
            .font(.footnote)
            .monospacedDigit()
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityIdentifier("activity.totals")
    }
}

private struct ActivityDayHeader: View {
    @Environment(ShellModel.self) private var shell
    let day: CalendarDate
    let net: Int64
    let currency: String

    var body: some View {
        HStack {
            Text(DayText.long(day, today: shell.today))
            Spacer()
            Text(MoneyFormat.signed(net, meaning: net > 0 ? .income : .neutral, currency: currency))
                .foregroundStyle(net > 0 ? PennyColor.income : PennyColor.secondaryLabel)
                .monospacedDigit()
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(PennyColor.secondaryLabel)
        .accessibilityElement(children: .combine)
    }
}

/// Where an Activity row leads: a personal entry's detail, or the shared expense in its household.
enum ActivityRoute {
    static func destination(_ entry: ReportEntry) -> DetailRoute {
        switch entry.source {
        case .personal: .entry(id: entry.id)
        case .shared(let household, let expense): .householdExpense(householdID: household, expenseID: expense)
        }
    }
}

enum ActivityPeriodText {
    static func title(_ period: ActivityFilters.Period) -> String {
        switch period {
        case .month(let month): MonthPicker.title(month, long: false)
        case .year(let year): String(year)
        case .allTime: "All time"
        }
    }

    /// "November expenses", "2026", "all months".
    static func scope(_ filters: ActivityFilters) -> String {
        let period: String =
            if let day = filters.day {
                DayText.date(day).formatted(.dateTime.month(.wide).day())
            } else {
                switch filters.period {
                case .month(let month): MonthPicker.title(month, long: false)
                case .year(let year): String(year)
                case .allTime: "all months"
                }
            }
        let kind: String =
            switch filters.kind {
            case nil: "entries"
            case .expense: "expenses"
            case .income: "income"
            case .investment: "investments"
            }
        return "\(period) \(kind)"
    }
}
