/// What Activity shows (MAZ-73): a period (month, year or all time), optionally one day of it,
/// a kind, a category and a search query. A value, so the screen, server search and local
/// search all read the same filters, and a server page can be checked against the filters it
/// was asked for.
public struct ActivityFilters: Hashable, Sendable {
    public enum Period: Hashable, Sendable {
        case month(MonthKey)
        case year(Int)
        case allTime
    }

    public var period: Period {
        didSet { if let day, !period.contains(day) { self.day = nil } }
    }
    /// One day inside `period`; nil for the whole period.
    public var day: CalendarDate?
    public var kind: EntryKind? {
        didSet { if kind != oldValue { categoryId = nil } }
    }
    /// A category of `kind` (cleared when the kind changes).
    public var categoryId: String?
    public var query: String

    public init(
        period: Period, day: CalendarDate? = nil, kind: EntryKind? = nil, categoryId: String? = nil, query: String = ""
    ) {
        self.period = period
        self.day = day.flatMap { period.contains($0) ? $0 : nil }
        self.kind = kind
        self.categoryId = categoryId
        self.query = query
    }

    /// The query as search matches it (normalized), empty when there is nothing to search.
    public var normalizedQuery: String { SearchText.normalize(query) }
    public var hasQuery: Bool { !normalizedQuery.isEmpty }

    /// Whether anything beyond the period narrows the list (for "Clear filters").
    public var isNarrowed: Bool { day != nil || kind != nil || categoryId != nil }

    /// Removes the day, kind and category; keeps the period and the query.
    public mutating func clearNarrowing() {
        day = nil
        kind = nil
        categoryId = nil
    }

    /// The inclusive date bounds a search sends (`from`/`to`); nil means unbounded.
    public var dateRange: (from: CalendarDate?, to: CalendarDate?) {
        if let day { return (day, day) }
        switch period {
        case .month(let month): return (month.first, month.last)
        case .year(let year):
            return (CalendarDate(year: year, month: 1, day: 1), CalendarDate(year: year, month: 12, day: 31))
        case .allTime: return (nil, nil)
        }
    }

    /// Whether a row passes every filter except the query.
    public func admits(_ entry: ReportEntry) -> Bool {
        (day == nil ? period.contains(entry.date) : entry.date == day) && (kind == nil || entry.kind == kind)
            && (categoryId == nil || entry.categoryId == categoryId)
    }
}

extension ActivityFilters.Period {
    public func contains(_ date: CalendarDate) -> Bool {
        switch self {
        case .month(let month): month.contains(date)
        case .year(let year): date.year == year
        case .allTime: true
        }
    }
}

/// Activity's rows and the period's totals.
public struct ActivityResult: Equatable, Sendable {
    /// The whole period's recorded totals (your shares). The day, kind, category and query
    /// never change them, so filtering never makes money look different.
    public let summary: KindTotals
    /// Matching recorded rows (never previews), newest first then id: chronological, so the
    /// list can group them by day whatever the query.
    public let entries: [ReportEntry]
}

extension LedgerReport {
    /// Activity over this device's data (personal entries with pending changes, the demo, or
    /// any shared rows the report holds), searched with the shared normalization and literal
    /// tiers (`FoldedSearchIndex`). Pass the index built for this report.
    public func activity(_ filters: ActivityFilters, index: FoldedSearchIndex) -> ActivityResult {
        let periodEntries = recorded.filter { filters.period.contains($0.date) }
        let needle = FoldedSearchIndex.needle(filters.query)
        let entries =
            periodEntries
            .filter { filters.admits($0) && index.match($0, needle: needle) != nil }
            .sorted(by: ReportEntry.newestFirst)
        return ActivityResult(summary: KindTotals(periodEntries), entries: entries)
    }

    /// The period's recorded totals alone (what Activity shows above server results).
    public func totals(_ period: ActivityFilters.Period) -> KindTotals {
        KindTotals(recorded.filter { period.contains($0.date) })
    }
}

extension ReportEntry {
    /// A recorded personal entry as a report row (server search results, entry detail).
    public static func recorded(_ entry: LedgerEntry) -> ReportEntry { ReportEntry(personal: entry, scheduled: false) }

    /// A recorded shared share as a report row.
    public static func shared(_ item: SharedExpenseShare) -> ReportEntry { ReportEntry(shared: item) }

    /// Chronological order: newest date first, then id (the order of every list).
    public static func chronological(_ lhs: ReportEntry, _ rhs: ReportEntry) -> Bool { newestFirst(lhs, rhs) }
}

/// Days of a chronological list, each with its rows and its net (income minus expenses and
/// contributions, your shares), in list order.
public struct ActivityDay: Equatable, Sendable {
    public let date: CalendarDate
    public let entries: [ReportEntry]
    public let net: Int64

    /// Groups `entries` (already chronological) by day, keeping their order.
    public static func group(_ entries: [ReportEntry]) -> [ActivityDay] {
        var result: [ActivityDay] = []
        for entry in entries {
            let signed = entry.kind == .income ? entry.share : -entry.share
            if let last = result.last, last.date == entry.date {
                result[result.count - 1] = ActivityDay(
                    date: last.date, entries: last.entries + [entry], net: last.net + signed)
            } else {
                result.append(ActivityDay(date: entry.date, entries: [entry], net: signed))
            }
        }
        return result
    }
}

/// Unsaved entry drafts kept when a form closes without saving or discarding (a deep link,
/// Settings or the app replacing the sheet), so reopening it restores the work. One draft for
/// a new entry and one per edited entry; a saved or untouched draft is never kept. The shell
/// stores the shelf per account (`LedgerWorkspace.saveDrafts`), so drafts survive a relaunch.
public struct EntryDraftShelf: Hashable, Sendable {
    private var drafts: [String: EntryEditor] = [:]

    public init() {}

    /// A shelf holding `kept`, as read back from storage.
    public init(kept: [EntryEditor]) {
        for editor in kept { keep(editor) }
    }

    /// Every kept draft, in a stable order (by key), for storage.
    public var kept: [EntryEditor] {
        drafts.sorted { $0.key < $1.key }.map(\.value)
    }

    static func key(_ mode: EntryEditor.Mode) -> String {
        switch mode {
        case .new: "new"
        case .edit(let entry): "edit:\(entry.id)"
        }
    }

    /// Keeps `editor` if it holds unsaved work; otherwise forgets any earlier draft for it. A
    /// draft whose save is still running is kept too, as not saved (`EntryEditor.resumable`),
    /// until that save succeeds and the form discards it: if the sheet was replaced meanwhile
    /// and the save then fails, the draft is still here.
    public mutating func keep(_ editor: EntryEditor) {
        let key = Self.key(editor.mode)
        if editor.isDirty, !editor.isSaved {
            drafts[key] = editor.resumable
        } else {
            drafts[key] = nil
        }
    }

    /// The kept draft for a new entry or for editing `entry`, removed from the shelf.
    public mutating func take(_ mode: EntryEditor.Mode) -> EntryEditor? {
        drafts.removeValue(forKey: Self.key(mode))
    }

    public func has(_ mode: EntryEditor.Mode) -> Bool { drafts[Self.key(mode)] != nil }

    public mutating func discard(_ mode: EntryEditor.Mode) { drafts[Self.key(mode)] = nil }
}
