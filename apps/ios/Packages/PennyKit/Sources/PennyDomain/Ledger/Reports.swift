/// Personal-share totals by kind, in integer cents. Income and spending are not an account
/// balance; investments are contributions (money put in), not portfolio value.
public struct KindTotals: Hashable, Sendable {
    public var expense: Int64
    public var income: Int64
    public var investment: Int64

    public static let zero = KindTotals(expense: 0, income: 0, investment: 0)

    public init(expense: Int64, income: Int64, investment: Int64) {
        self.expense = expense
        self.income = income
        self.investment = investment
    }

    /// Sums `share`, never `total` (legacy `totals`). Every row a report holds has a share of
    /// at most `Money.maxCents` (99,999,999,999): personal rows because a ledger with any other
    /// amount fails `Ledger.violations` and is never stored, shared rows because `LedgerReport`
    /// leaves out-of-range wire rows out. So a sum cannot overflow Int64 below about 92 million
    /// rows, far beyond 100,000 entries, 1,000 rules' previews and any projection response.
    public init(_ entries: some Sequence<ReportEntry>) {
        self = .zero
        for entry in entries { add(entry.kind, entry.share) }
    }

    mutating func add(_ kind: EntryKind, _ cents: Int64) {
        switch kind {
        case .expense: expense += cents
        case .income: income += cents
        case .investment: investment += cents
        }
    }

    /// Income minus expenses and investment contributions. Negative when more went out.
    public var remaining: Int64 { income - expense - investment }
}

/// The caller's share of one shared household expense, from the server's personal
/// projection (`GET /api/households/projection`; docs/migration/shared-expenses.md). Shared
/// rows are server-owned: they are shown beside the personal ledger, never copied into it.
public struct SharedExpenseShare: Hashable, Sendable {
    public struct Category: Hashable, Sendable {
        public var name: String
        public var icon: String
        public var color: String

        public init(name: String, icon: String, color: String) {
            self.name = name
            self.icon = icon
            self.color = color
        }
    }

    /// The expense id, or `ruleId:date` for a scheduled preview.
    public var id: String
    public var householdId: String
    /// The household's currency. A share in another currency than the ledger is left out of
    /// every report rather than added across currencies.
    public var currency: Currency
    public var title: String
    public var date: CalendarDate
    public var total: Int64
    public var share: Int64
    public var category: Category
    public var note: String
    /// Only the payer sees their own account.
    public var accountId: String?
    public var recurringId: String?
    /// A preview of an occurrence a shared rule has not recorded yet.
    public var scheduled: Bool

    public init(
        id: String, householdId: String, currency: Currency, title: String, date: CalendarDate, total: Int64,
        share: Int64, category: Category, note: String = "", accountId: String? = nil, recurringId: String? = nil,
        scheduled: Bool = false
    ) {
        self.id = id
        self.householdId = householdId
        self.currency = currency
        self.title = title
        self.date = date
        self.total = total
        self.share = share
        self.category = category
        self.note = note
        self.accountId = accountId
        self.recurringId = recurringId
        self.scheduled = scheduled
    }
}

/// One row in a report: a personal entry, a shared share, or a scheduled preview of either.
public struct ReportEntry: Hashable, Sendable, Identifiable {
    public enum Source: Hashable, Sendable {
        case personal
        case shared(householdId: String, expenseId: String)
    }

    /// Personal: the entry id (`ruleId:date` for a preview). Shared: `household:{householdId}:{id}`,
    /// the legacy view id, so a shared row can never collide with a personal one.
    public var id: String
    public var source: Source
    public var kind: EntryKind
    public var title: String
    public var date: CalendarDate
    public var total: Int64
    public var share: Int64
    public var categoryId: String
    public var accountId: String?
    public var tripId: String?
    public var note: String
    public var recurringId: String?
    /// Not recorded yet: a preview, never cash.
    public var scheduled: Bool

    init(personal entry: LedgerEntry, scheduled: Bool) {
        id = entry.id
        source = .personal
        kind = entry.kind
        title = entry.title
        date = entry.date
        total = entry.total
        share = entry.share
        categoryId = entry.categoryId
        accountId = entry.accountId
        tripId = entry.tripId
        note = entry.note
        recurringId = entry.recurringId
        self.scheduled = scheduled
    }

    static func sharedID(_ item: SharedExpenseShare) -> String { "household:\(item.householdId):\(item.id)" }

    init(shared item: SharedExpenseShare) {
        id = ReportEntry.sharedID(item)
        source = .shared(householdId: item.householdId, expenseId: item.id)
        kind = .expense
        title = item.title
        date = item.date
        total = item.total
        share = item.share
        categoryId = SharedExpenseShare.categoryID(item.category)
        accountId = item.accountId
        tripId = nil
        note = item.note
        recurringId = item.recurringId
        scheduled = item.scheduled
    }

    /// Newest first, then id in ordinal order: a total order, so lists and pages never shuffle.
    static func newestFirst(_ lhs: ReportEntry, _ rhs: ReportEntry) -> Bool {
        lhs.date != rhs.date ? lhs.date > rhs.date : JavaScriptText.ordinalLess(lhs.id, rhs.id)
    }
}

extension SharedExpenseShare {
    /// Shared categories are matched by look, not id (legacy `household-category:name:icon:color`).
    static func categoryID(_ category: Category) -> String {
        "household-category:\(category.name):\(category.icon):\(category.color)"
    }

    /// One row per view id, in first-seen order, holding the last copy (a JavaScript `Map`
    /// filled with `set`). Ids compare by UTF-16 code units, like `Map` keys.
    static func lastWins(_ items: [SharedExpenseShare]) -> [SharedExpenseShare] {
        var positions: [[UInt16]: Int] = [:]
        var result: [SharedExpenseShare] = []
        for item in items {
            let key = Array(ReportEntry.sharedID(item).utf16)
            if let position = positions[key] {
                result[position] = item
            } else {
                positions[key] = result.count
                result.append(item)
            }
        }
        return result
    }
}

/// Spending in one category.
public struct CategoryAmount: Hashable, Sendable {
    public var category: LedgerCategory
    public var amount: Int64
}

/// The personal ledger joined with the caller's shared shares: the read model every report
/// uses. It is a view: it never writes to the ledger and must never be sent as one.
public struct LedgerReport: Sendable {
    public let ledger: Ledger
    /// Recorded personal entries, then recorded shared shares (once each).
    public let recorded: [ReportEntry]
    /// Personal categories, then one expense category per distinct shared category.
    public let categories: [LedgerCategory]
    let sharedScheduled: [ReportEntry]
    let categoryNames: [String: String]
    let accountNames: [String: String]

    /// Shared projection deduplication: a row repeated across period responses (same household
    /// and id) appears once, at the position its id was first seen, with the values of its *last*
    /// copy, as the legacy `Map` with `unique.set` did; so the caller passes older responses
    /// first. The last copy decides everything, its currency and amounts too. A recorded
    /// occurrence replaces its preview, and a preview never repeats a recorded row's id.
    ///
    /// Shared amounts come from the wire, so a row outside the ledger's stored bounds (total
    /// 1...`Money.maxCents`, share 0...total: the same bounds the server stores) is left out, as
    /// is a row in another currency than the ledger.
    ///
    /// - Parameters:
    ///   - shared: recorded shared shares; may repeat rows from several period responses.
    ///   - sharedScheduled: the server's month previews of shared rules.
    public init(ledger: Ledger, shared: [SharedExpenseShare] = [], sharedScheduled: [SharedExpenseShare] = []) {
        self.ledger = ledger
        var categories = ledger.categories
        var categoryIDs = Set(categories.map(\.id))
        func view(_ item: SharedExpenseShare) -> ReportEntry? {
            guard item.currency == ledger.currency, Money.isValidAmounts(total: item.total, share: item.share)
            else { return nil }
            let entry = ReportEntry(shared: item)
            if categoryIDs.insert(entry.categoryId).inserted {
                categories.append(
                    LedgerCategory(
                        id: entry.categoryId, name: item.category.name, icon: item.category.icon,
                        color: item.category.color, kind: .expense))
            }
            return entry
        }
        var recorded = ledger.transactions.map { ReportEntry(personal: $0, scheduled: false) }
        var occurrences = Set<String>()
        var recordedIDs = Set<[UInt16]>()
        for item in SharedExpenseShare.lastWins(shared.filter { !$0.scheduled }) {
            guard let entry = view(item) else { continue }
            recorded.append(entry)
            recordedIDs.insert(Array(entry.id.utf16))
            if let rule = item.recurringId { occurrences.insert("\(item.householdId)|\(rule)|\(item.date)") }
        }
        // A recorded occurrence replaces its preview, even when the preview came from an older
        // response than the recorded row.
        var scheduled: [ReportEntry] = []
        for item in SharedExpenseShare.lastWins((sharedScheduled + shared).filter(\.scheduled)) {
            if let rule = item.recurringId, occurrences.contains("\(item.householdId)|\(rule)|\(item.date)") {
                continue
            }
            guard !recordedIDs.contains(Array(ReportEntry.sharedID(item).utf16)), let entry = view(item) else {
                continue
            }
            var preview = entry
            preview.scheduled = true
            scheduled.append(preview)
        }
        self.recorded = recorded
        self.categories = categories
        self.sharedScheduled = scheduled
        categoryNames = Dictionary(categories.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        accountNames = Dictionary(ledger.accounts.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    func categoryName(_ id: String) -> String { categoryNames[id] ?? "" }
    func accountName(_ id: String?) -> String { id.flatMap { accountNames[$0] } ?? "" }

    /// Recorded expenses by category, largest first; ties keep category order.
    func spending(_ entries: [ReportEntry]) -> [CategoryAmount] {
        var amounts: [String: Int64] = [:]
        for entry in entries where entry.kind == .expense { amounts[entry.categoryId, default: 0] += entry.share }
        return categories.enumerated()
            .compactMap { index, category -> (Int, CategoryAmount)? in
                guard category.kind == .expense, let amount = amounts[category.id], amount > 0 else { return nil }
                return (index, CategoryAmount(category: category, amount: amount))
            }
            .sorted { $0.1.amount != $1.1.amount ? $0.1.amount > $1.1.amount : $0.0 < $1.0 }
            .map(\.1)
    }
}

/// Home for one month: what was recorded, what is scheduled, and both totals side by side.
public struct MonthSummary: Hashable, Sendable {
    public let month: MonthKey
    /// Entries recorded in the month, personal and shared.
    public let recordedEntries: [ReportEntry]
    /// Occurrences of active personal and shared rules not recorded yet, oldest first.
    public let scheduled: [ReportEntry]
    /// Recorded only: the basis of **Left to spend**.
    public let recorded: KindTotals
    /// Recorded plus every occurrence in `scheduled`: scheduled income, expenses and investment
    /// contributions, personal and shared (v2 `summarizeMonth` `projected`, redesign-states.json
    /// `projected`). The legacy app added scheduled income only (MAZ-139).
    public let projected: KindTotals
    /// The scheduled income included in `projected`: expected, not cash available today.
    public let expectedIncome: Int64
    /// Recorded spending by category (largest first).
    public let spending: [CategoryAmount]

    /// Left to spend: recorded income minus recorded expenses and contributions, signed
    /// (v2 `recordedNet`).
    public var recordedRemaining: Int64 { recorded.remaining }
    /// Projected remaining: the same with every scheduled occurrence added, signed (v2 `projectedNet`).
    public var projectedRemaining: Int64 { projected.remaining }
}

extension LedgerReport {
    /// The month's recorded and projected totals. Previews come from each active personal
    /// rule's `nextDate` (they are not recorded until materialized, wherever they fall) and from
    /// the server's shared previews; an occurrence already recorded is never counted again.
    public func month(_ month: MonthKey) -> MonthSummary {
        let recordedEntries = recorded.filter { month.contains($0.date) }
        let personal = Recurrence.previews(ledger, from: month.first, through: month.last)
            .map { ReportEntry(personal: $0, scheduled: true) }
        let shared = sharedScheduled.filter { month.contains($0.date) }
        let scheduled = (personal + shared).sorted {
            $0.date != $1.date ? $0.date < $1.date : JavaScriptText.ordinalLess($0.id, $1.id)
        }
        let recordedTotals = KindTotals(recordedEntries)
        // v2 `monthBreakdown`: projection adds every scheduled occurrence (income, expenses and
        // investments). A recorded occurrence has already replaced its preview, so none counts twice.
        let expectedIncome = scheduled.filter { $0.kind == .income }.reduce(0) { $0 + $1.share }
        let projected = KindTotals(recordedEntries + scheduled)
        return MonthSummary(
            month: month, recordedEntries: recordedEntries, scheduled: scheduled, recorded: recordedTotals,
            projected: projected, expectedIncome: expectedIncome, spending: spending(recordedEntries))
    }

    /// Home's entry list: recorded and scheduled rows of the month that match the filters,
    /// newest first then id. Filters never change the month's totals. The query is trimmed, as
    /// on every screen (v2 `searchMatcher`).
    public func monthEntries(
        _ summary: MonthSummary, query: String = "", kind: EntryKind? = nil, day: CalendarDate? = nil,
        categoryId: String? = nil
    ) -> [ReportEntry] {
        let matches = matcher(query)
        return (summary.recordedEntries + summary.scheduled)
            .filter {
                (day == nil || $0.date == day) && (kind == nil || $0.kind == kind)
                    && (categoryId == nil || $0.categoryId == categoryId) && matches($0)
            }
            .sorted(by: ReportEntry.newestFirst)
    }
}

/// The Activity period: a month or a calendar year.
public enum ActivityPeriod: Hashable, Sendable {
    case month(MonthKey)
    case year(Int)

    func contains(_ date: CalendarDate) -> Bool {
        switch self {
        case .month(let month): month.contains(date)
        case .year(let year): date.year == year
        }
    }
}

public struct ActivityPage: Equatable, Sendable {
    /// The whole period's recorded totals; the query, kind and day never change them.
    public let summary: KindTotals
    public let entries: [ReportEntry]
    /// Matching entries across all pages.
    public let totalCount: Int
    /// The page shown, clamped to 0..<pageCount.
    public let page: Int
    public let pageCount: Int

    /// `entries` grouped by day, newest day first.
    public var days: [(date: CalendarDate, entries: [ReportEntry])] {
        var result: [(date: CalendarDate, entries: [ReportEntry])] = []
        for entry in entries {
            if result.last?.date == entry.date {
                result[result.count - 1].entries.append(entry)
            } else {
                result.append((entry.date, [entry]))
            }
        }
        return result
    }
}

extension LedgerReport {
    public static let activityPageSize = 50

    /// Activity: recorded entries only (personal and shared, never previews), newest first and
    /// then by id, 50 per page. A recorded recurring occurrence is an ordinary recorded entry.
    public func activity(
        _ period: ActivityPeriod, query: String = "", kind: EntryKind? = nil, day: CalendarDate? = nil, page: Int = 0
    ) -> ActivityPage {
        let periodEntries = recorded.filter { period.contains($0.date) }
        let matchesQuery = matcher(query)
        let matches = periodEntries.filter {
            (kind == nil || $0.kind == kind) && (day == nil || $0.date == day) && matchesQuery($0)
        }
        .sorted(by: ReportEntry.newestFirst)
        let size = LedgerReport.activityPageSize
        let pageCount = max(1, (matches.count + size - 1) / size)
        let page = min(max(page, 0), pageCount - 1)
        return ActivityPage(
            summary: KindTotals(periodEntries), entries: Array(matches.dropFirst(page * size).prefix(size)),
            totalCount: matches.count, page: page, pageCount: pageCount)
    }
}

/// A personal trip's spending. Only personal expenses belong to trips.
public struct TripSummary: Hashable, Sendable {
    /// Newest first, then id ascending: the one order of every list (v2 `byDateDescThenId`;
    /// the old `tripOverview` broke ties by id descending).
    public let expenses: [LedgerEntry]
    public let spending: [CategoryAmount]
    /// Your shares: what counts toward trip spending.
    public let total: Int64
    /// The receipt totals, shown when they differ from `total`.
    public let receiptTotal: Int64
}

extension LedgerReport {
    public func trip(_ trip: Trip) -> TripSummary {
        let expenses = ledger.transactions.filter { $0.kind == .expense && $0.tripId == trip.id }
            .sorted { $0.date != $1.date ? $0.date > $1.date : JavaScriptText.ordinalLess($0.id, $1.id) }
        return TripSummary(
            expenses: expenses, spending: spending(expenses.map { ReportEntry(personal: $0, scheduled: false) }),
            total: expenses.reduce(0) { $0 + $1.share }, receiptTotal: expenses.reduce(0) { $0 + $1.total })
    }

    /// Spent share and expense count per trip id (legacy `tripSummaries`).
    public var tripTotals: [String: (total: Int64, count: Int)] {
        var result: [String: (total: Int64, count: Int)] = [:]
        for entry in ledger.transactions where entry.kind == .expense {
            guard let tripId = entry.tripId else { continue }
            let current = result[tripId] ?? (0, 0)
            result[tripId] = (current.total + entry.share, current.count + 1)
        }
        return result
    }
}
