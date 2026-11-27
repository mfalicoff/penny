// The monthly recap (MAZ-292): last month's recorded numbers next to the month before it and the
// same month a year earlier, the categories that moved most, shared expenses and quiet days.
// A port of `monthReview` in apps/web/src/domain/monthReview.ts, checked against
// contracts/fixtures/month-review.json (`MonthReviewTests`). Named `MonthReview` because
// `MonthRecap` is the household settlement on the web.
//
// Input is the person's report (`LedgerReport`): their ledger with their shared shares joined in,
// so shared expenses count at the person's share and shared rows in another currency are already
// left out. Only recorded entries count, never scheduled previews (`LedgerReport.month`).
//
// Amounts are integer cents. Percentages are whole numbers rounded half away from zero, as on the
// web, and nil where there is nothing to compare with (never ±∞).

/// Whole percentages, rounded the same way on every platform.
public enum ReviewPercent {
    /// Whole percent of `part` in `whole` (0 when there is no whole), rounded half away from zero.
    public static func of(_ part: Int64, _ whole: Int64) -> Int {
        guard whole > 0 else { return 0 }
        return rounded((Double(part) / Double(whole)) * 100)
    }

    /// Whole-percent change from `before` to `after`; nil when `before` isn't known or is 0.
    public static func change(after: Int64, before: Int64?) -> Int? {
        guard let before, before > 0 else { return nil }
        return rounded((Double(after - before) / Double(before)) * 100)
    }

    /// Half away from zero; a tiny drop reads 0, never -0.
    static func rounded(_ value: Double) -> Int {
        let magnitude = Int(value.magnitude.rounded(.toNearestOrAwayFromZero))
        return value < 0 ? -magnitude : magnitude
    }
}

// MARK: - Category comparison

/// Spending in one category, the input of `CategoryChange.compare`.
public struct CategorySpending: Hashable, Sendable {
    public var id: String
    public var name: String
    public var icon: String
    public var color: String
    public var amount: Int64

    public init(id: String, name: String, icon: String, color: String, amount: Int64) {
        self.id = id
        self.name = name
        self.icon = icon
        self.color = color
        self.amount = amount
    }

    public init(_ category: LedgerCategory, amount: Int64) {
        self.init(id: category.id, name: category.name, icon: category.icon, color: category.color, amount: amount)
    }
}

/// One category's spending this month next to last month's (the web's `categoryComparison`).
public struct CategoryChange: Hashable, Sendable {
    /// The category's name trimmed and without case, or `more` for the grouped row.
    public var key: String
    /// The first category seen with this key (this month's before last month's); empty for `more`.
    public var categoryId: String
    public var name: String
    public var icon: String
    public var color: String
    public var current: Int64
    public var previous: Int64
    /// Whole percent of this month's spending.
    public var share: Int

    public init(
        key: String, categoryId: String, name: String, icon: String, color: String, current: Int64,
        previous: Int64, share: Int
    ) {
        self.key = key
        self.categoryId = categoryId
        self.name = name
        self.icon = icon
        self.color = color
        self.current = current
        self.previous = previous
        self.share = share
    }

    /// `current - previous`.
    public var change: Int64 { current - previous }

    static let moreKey = "more"

    /// Categories match by name, trimmed and without case (shared categories travel by value, and
    /// the same name is the same category to the person). Largest this month first, then largest
    /// last month, then by key in code-unit order. Past `limit + 1` rows, the smallest are summed
    /// into one "N more" row (`key` `more`); `limit` nil keeps every row.
    public static func compare(
        current: [CategorySpending], previous: [CategorySpending], limit: Int? = 8
    ) -> [CategoryChange] {
        var rows: [String: CategoryChange] = [:]
        var order: [String] = []
        func add(_ list: [CategorySpending], current isCurrent: Bool) {
            for category in list {
                let key = Self.key(category.name)
                if rows[key] == nil {
                    order.append(key)
                    rows[key] = CategoryChange(
                        key: key, categoryId: category.id, name: category.name, icon: category.icon,
                        color: category.color, current: 0, previous: 0, share: 0)
                }
                if isCurrent { rows[key]?.current += category.amount } else { rows[key]?.previous += category.amount }
            }
        }
        add(current, current: true)
        add(previous, current: false)
        let total = current.reduce(Int64(0)) { $0 + $1.amount }
        let sorted = order.compactMap { rows[$0] }
            .map { row -> CategoryChange in
                var row = row
                row.share = ReviewPercent.of(row.current, total)
                return row
            }
            .sorted {
                if $0.current != $1.current { return $0.current > $1.current }
                if $0.previous != $1.previous { return $0.previous > $1.previous }
                return JavaScriptText.ordinalLess($0.key, $1.key)
            }
        guard let limit, sorted.count > limit + 1 else { return sorted }
        let rest = sorted.dropFirst(limit)
        let more = CategoryChange(
            key: moreKey, categoryId: "", name: "\(rest.count) more", icon: "ellipsis-horizontal", color: "",
            current: rest.reduce(0) { $0 + $1.current }, previous: rest.reduce(0) { $0 + $1.previous },
            share: ReviewPercent.of(rest.reduce(0) { $0 + $1.current }, total))
        return Array(sorted.prefix(limit)) + [more]
    }

    static func key(_ name: String) -> String { JavaScriptText.lowercase(JavaScriptText.trim(name)) }
}

/// The month-over-month sentence (`iphone-insights` card, the web's `spendingChange`): the change in
/// recorded spending and the (at most two) categories that moved most in that direction. The
/// grouped "N more" row is never named.
public struct SpendingChange: Hashable, Sendable {
    public let delta: Int64
    public let drivers: [String]

    public init(current: Int64, previous: Int64, comparison: [CategoryChange]) {
        let delta = current - previous
        self.delta = delta
        guard delta != 0 else {
            drivers = []
            return
        }
        drivers = comparison.enumerated()
            .filter { $0.element.key != CategoryChange.moreKey && $0.element.change.signum() == delta.signum() }
            .sorted {
                let lhs = $0.element.change.magnitude
                let rhs = $1.element.change.magnitude
                return lhs != rhs ? lhs > rhs : $0.offset < $1.offset
            }
            .prefix(2)
            .map(\.element.name)
    }
}

// MARK: - The recap

/// The recap's spending in another month.
public struct ComparedMonth: Hashable, Sendable {
    /// Nil only outside the ledger's range (before 2000).
    public let month: MonthKey?
    /// Recorded spending; nil when nothing is recorded in or before this month ("No September to
    /// compare with").
    public let spent: Int64?
    /// Whole-percent change of the recap month's spending against this month; nil with nothing to
    /// compare.
    public let change: Int?
}

/// A category that moved against the month before.
public struct BiggestChange: Hashable, Sendable {
    public let key: String
    public let categoryId: String
    public let name: String
    public let icon: String
    public let color: String
    public let current: Int64
    public let previous: Int64
    public let change: Int64
    /// Whole-percent change; nil for a category with nothing the month before ("New").
    public let percent: Int?
}

/// The largest shared expense of the month, at your share.
public struct TopShared: Hashable, Sendable {
    /// The view id, `household:<household>:<expense>`.
    public let id: String
    public let title: String
    public let categoryId: String
    public let date: CalendarDate
    public let share: Int64
    public let total: Int64
    /// Who paid; nil when the server didn't say.
    public let payer: SharedPayer?

    public init(
        id: String, title: String, categoryId: String, date: CalendarDate, share: Int64, total: Int64,
        payer: SharedPayer?
    ) {
        self.id = id
        self.title = title
        self.categoryId = categoryId
        self.date = date
        self.share = share
        self.total = total
        self.payer = payer
    }
}

/// The month's recap (MAZ-292).
public struct MonthReview: Hashable, Sendable {
    public let month: MonthKey
    /// No recorded entry in the month (a month with only scheduled entries counts as none).
    public let isEmpty: Bool
    public let spent: Int64
    public let cameIn: Int64
    public let invested: Int64
    /// Came in − spent − invested; negative means overspent.
    public let leftOver: Int64
    public let previous: ComparedMonth
    public let lastYear: ComparedMonth
    /// Up to three categories that moved most against the month before, largest move first.
    /// Empty for a first month.
    public let biggestChanges: [BiggestChange]
    /// Recorded shared expenses, at your share.
    public let shared: Shared
    /// Recorded expenses split with others (total above your share), personal and shared.
    public let split: Split
    /// Days of the month up to today with no recorded expense.
    public let daysWithoutSpending: Int
    /// The longest run of them, the earliest on a tie; nil without one.
    public let longestRun: Run?

    public struct Shared: Hashable, Sendable {
        public let count: Int
        public let spent: Int64
        public let top: TopShared?
    }

    public struct Split: Hashable, Sendable {
        public let count: Int
        public let total: Int64
        public let share: Int64
        public var othersPaid: Int64 { total - share }

        public init(count: Int, total: Int64, share: Int64) {
            self.count = count
            self.total = total
            self.share = share
        }
    }

    public struct Run: Hashable, Sendable {
        public let start: CalendarDate
        public let end: CalendarDate
        public let days: Int
    }

    /// The month whose recap banner shows on Home and Insights: last month, during the first 7 days
    /// of this month (owner decision, 2026-11-26). Nil otherwise. Dismissing it is kept on the device.
    public static func bannerMonth(today: CalendarDate) -> MonthKey? {
        today.day <= 7 ? MonthKey(today).shifted(by: -1) : nil
    }
}

extension LedgerReport {
    /// The recap of `month`. `today` is the person's local date (MAZ-136): income dated after it is
    /// expected, not recorded, and days after it aren't counted as days without spending.
    public func review(_ month: MonthKey, today: CalendarDate) -> MonthReview {
        let current = self.month(month, today: today)
        // The first month with a recorded entry: previews never count, and income dated after
        // today is expected.
        let first = recorded.filter { !$0.isExpectedIncome(today: today) }.map { MonthKey($0.date) }.min()
        func compare(_ offset: Int) -> (ComparedMonth, MonthSummary?) {
            guard let other = month.shifted(by: offset), let first, first <= other else {
                return (ComparedMonth(month: month.shifted(by: offset), spent: nil, change: nil), nil)
            }
            let summary = self.month(other, today: today)
            let spent = summary.recorded.expense
            return (
                ComparedMonth(
                    month: other, spent: spent,
                    change: ReviewPercent.change(after: current.recorded.expense, before: spent)),
                summary
            )
        }
        let (previous, previousSummary) = compare(-1)
        let (lastYear, _) = compare(-12)

        var biggestChanges: [BiggestChange] = []
        if let previousSummary {
            biggestChanges = CategoryChange.compare(
                current: spendingByCategory(current.recordedEntries),
                previous: spendingByCategory(previousSummary.recordedEntries), limit: nil
            )
            .enumerated()
            .filter { $0.element.change != 0 }
            .sorted {
                let lhs = $0.element.change.magnitude
                let rhs = $1.element.change.magnitude
                return lhs != rhs ? lhs > rhs : $0.offset < $1.offset
            }
            .prefix(3)
            .map {
                let row = $0.element
                return BiggestChange(
                    key: row.key, categoryId: row.categoryId, name: row.name, icon: row.icon, color: row.color,
                    current: row.current, previous: row.previous, change: row.change,
                    percent: ReviewPercent.change(after: row.current, before: row.previous))
            }
        }

        let expenses = current.recordedEntries.filter { $0.kind == .expense }
        let shared = expenses.filter {
            if case .shared = $0.source { return true }
            return false
        }
        let top = shared.sorted {
            if $0.share != $1.share { return $0.share > $1.share }
            if $0.date != $1.date { return $0.date > $1.date }
            return JavaScriptText.ordinalLess($0.id, $1.id)
        }
        .first
        .map {
            TopShared(
                id: $0.id, title: $0.title, categoryId: $0.categoryId, date: $0.date, share: $0.share, total: $0.total,
                payer: $0.payer)
        }
        let splits = expenses.filter { $0.total > $0.share }
        let quiet = Self.quietDays(month, expenses: expenses, today: today)
        return MonthReview(
            month: month, isEmpty: current.recordedEntries.isEmpty, spent: current.recorded.expense,
            cameIn: current.recorded.income, invested: current.recorded.investment,
            leftOver: current.recorded.remaining, previous: previous, lastYear: lastYear,
            biggestChanges: biggestChanges,
            shared: MonthReview.Shared(count: shared.count, spent: shared.reduce(0) { $0 + $1.share }, top: top),
            split: MonthReview.Split(
                count: splits.count, total: splits.reduce(0) { $0 + $1.total },
                share: splits.reduce(0) { $0 + $1.share }),
            daysWithoutSpending: quiet.days, longestRun: quiet.run)
    }

    /// Recorded expenses by category, in category order (the comparison sorts them itself).
    func spendingByCategory(_ entries: [ReportEntry]) -> [CategorySpending] {
        var amounts: [String: Int64] = [:]
        for entry in entries where entry.kind == .expense { amounts[entry.categoryId, default: 0] += entry.share }
        return categories.compactMap { category in
            guard category.kind == .expense, let amount = amounts[category.id], amount > 0 else { return nil }
            return CategorySpending(category, amount: amount)
        }
    }

    /// Days up to `today` (the whole month once it's over) with no recorded expense, and the
    /// longest run of them (the earliest on a tie).
    static func quietDays(_ month: MonthKey, expenses: [ReportEntry], today: CalendarDate)
        -> (days: Int, run: MonthReview.Run?)
    {
        let spentOn = Set(expenses.filter { $0.share > 0 }.map(\.date))
        var days = 0
        var longest: MonthReview.Run?
        var start: CalendarDate?
        var length = 0
        var last: CalendarDate?
        func close() {
            if let start, let last, length > (longest?.days ?? 0) {
                longest = MonthReview.Run(start: start, end: last, days: length)
            }
            start = nil
            length = 0
        }
        var date = month.first
        while month.contains(date), date <= today {
            if spentOn.contains(date) {
                close()
            } else {
                days += 1
                if start == nil { start = date }
                length += 1
            }
            last = date
            date = date.adding(days: 1)
        }
        close()
        return (days, longest)
    }
}
