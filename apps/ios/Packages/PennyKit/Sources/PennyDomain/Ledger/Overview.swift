// Home's analysis views for one month (MAZ-77): the money flow, the calendar, the category
// breakdown and the month-over-month comparison. Every value here is derived from a
// `MonthSummary`, so the recorded/projected rules stay in one place (`LedgerReport.month`):
// these types never decide what is recorded, what is projected or what a shared row is worth.
// Amounts are the person's shares in integer cents (docs/ios-overview.md).

/// A whole-number percentage for display: `part` of `whole`, rounded half up. Nil when the
/// whole is zero or negative (there is nothing to take a share of).
public enum Percent {
    public static func rounded(_ part: Int64, of whole: Int64) -> Int? {
        guard whole > 0, part >= 0 else { return nil }
        // Integer arithmetic, exact for any amount a ledger can hold (at most 100,000 entries of
        // `Money.maxCents`, so `part * 200` stays far below Int64's limit).
        return Int((part * 200 + whole) / (whole * 2))
    }

    /// "45%", "<1%" for a share that rounds to zero but is not zero, nil without a whole.
    public static func text(_ part: Int64, of whole: Int64) -> String? {
        guard let value = rounded(part, of: whole) else { return nil }
        if value == 0 && part > 0 { return "<1%" }
        return "\(value)%"
    }
}

// MARK: - Money flow

/// "Follow your money": recorded income sources on the left, where the money went on the
/// right (expense categories, Invested, Left over). Recorded entries only, as **Left to
/// spend**: a scheduled preview or expected income is never drawn as money that moved.
///
/// Rules (design-kit `MoneyFlow`, src/domain `buildMoneyFlow`):
/// - Personal shares only: a split or shared expense counts the viewer's share.
/// - At most `maxRows` rows per column: with more categories, the largest `maxRows - 1` are
///   kept and the rest become one "N more" row, so every cent stays in the flow.
/// - Invested is a destination of its own, never an expense category (investments are
///   contributions, not spending and not portfolio value).
/// - A month where more went out than came in gets a "Beyond income" source for the gap; a
///   month with money left gets a "Left over" destination. Both columns then add up to `total`.
public struct MoneyFlow: Hashable, Sendable {
    public static let maxRows = 5

    public enum Role: Hashable, Sendable {
        /// An income category (left column).
        case income
        /// The part of the outflow income did not cover (left column, deficit months only).
        case beyondIncome
        /// An expense category (right column).
        case expense
        /// Several small categories folded into one row. `MoneyFlow.Node.categoryIds` lists them.
        case more(EntryKind)
        /// Investment contributions (right column).
        case invested
        /// Income not spent or invested (right column).
        case leftOver
    }

    public struct Node: Hashable, Sendable, Identifiable {
        /// `income:<category>`, `income:more`, `balance:gap`, `expense:<category>`,
        /// `expense:more`, `investment:total`, `balance:remaining`.
        public let id: String
        public let role: Role
        public let label: String
        public let amount: Int64
        /// The categories in this row: one for a category, several for "N more", none otherwise.
        public let categoryIds: [String]
        /// The category's stored `#RRGGBB` for a single category; nil for meaning rows.
        public let colorHex: String?

        public var isSource: Bool {
            switch role {
            case .income, .beyondIncome: true
            case .more(let kind): kind == .income
            case .expense, .invested, .leftOver: false
            }
        }
    }

    public let sources: [Node]
    public let destinations: [Node]
    /// Recorded income (your share).
    public let income: Int64
    /// Recorded spending (your share), investments excluded.
    public let expense: Int64
    /// Recorded investment contributions.
    public let investment: Int64
    /// `max(0, outflow - income)`.
    public let gap: Int64
    /// `max(0, income - outflow)`.
    public let remaining: Int64

    /// Expenses plus contributions: what went out.
    public var outflow: Int64 { expense + investment }
    /// The height of each column: `max(income, outflow)`.
    public var total: Int64 { max(income, outflow) }
    /// Nothing recorded this month.
    public var isEmpty: Bool { income == 0 && outflow == 0 }
    public var nodes: [Node] { sources + destinations }

    /// The flow of `entries` (the recorded entries of a month: `MonthSummary.recordedEntries`).
    /// Scheduled rows are ignored even if passed in.
    public init(entries: [ReportEntry], categories: [LedgerCategory]) {
        let recorded = entries.filter { !$0.scheduled }
        var sources = Self.group(recorded, categories, kind: .income)
        var destinations = Self.group(recorded, categories, kind: .expense)
        let totals = KindTotals(recorded)
        income = totals.income
        expense = totals.expense
        investment = totals.investment
        let net = totals.remaining
        gap = max(0, -net)
        remaining = max(0, net)
        if investment > 0 {
            destinations.append(
                Node(
                    id: "investment:total", role: .invested, label: "Invested", amount: investment, categoryIds: [],
                    colorHex: nil))
        }
        if gap > 0 {
            sources.append(
                Node(
                    id: "balance:gap", role: .beyondIncome, label: "Beyond income", amount: gap, categoryIds: [],
                    colorHex: nil))
        }
        if remaining > 0 {
            destinations.append(
                Node(
                    id: "balance:remaining", role: .leftOver, label: "Left over", amount: remaining, categoryIds: [],
                    colorHex: nil))
        }
        self.sources = sources
        self.destinations = destinations
    }

    /// The month's recorded flow.
    public init(_ summary: MonthSummary, categories: [LedgerCategory]) {
        self.init(entries: summary.recordedEntries, categories: categories)
    }

    public func node(id: String) -> Node? { nodes.first { $0.id == id } }

    /// The node's share of recorded income, for the focus card ("45% of income").
    public func percentOfIncome(_ node: Node) -> String? {
        switch node.role {
        case .beyondIncome: nil
        default: Percent.text(node.amount, of: income)
        }
    }

    /// An expense row's share of recorded spending ("77% of spending"). Nil for every other
    /// row: income, contributions and money left over are not spending.
    public func percentOfSpending(_ node: Node) -> String? {
        switch node.role {
        case .expense, .more(.expense): Percent.text(node.amount, of: expense)
        default: nil
        }
    }

    static func group(_ entries: [ReportEntry], _ categories: [LedgerCategory], kind: EntryKind) -> [Node] {
        var sums: [String: Int64] = [:]
        var order: [String] = []
        for entry in entries where entry.kind == kind && entry.share > 0 {
            if sums[entry.categoryId] == nil { order.append(entry.categoryId) }
            sums[entry.categoryId, default: 0] += entry.share
        }
        let byID = Dictionary(categories.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let prefix = kind == .income ? "income" : "expense"
        let nodes = order.map { id -> Node in
            let category = byID[id]
            return Node(
                id: "\(prefix):\(id)", role: kind == .income ? .income : .expense,
                label: category?.name ?? "Uncategorized", amount: sums[id] ?? 0, categoryIds: [id],
                colorHex: category?.color)
        }
        // Largest first; ties by id in ordinal order, so the layout never shuffles.
        .sorted { $0.amount != $1.amount ? $0.amount > $1.amount : JavaScriptText.ordinalLess($0.id, $1.id) }
        guard nodes.count > maxRows else { return nodes }
        let kept = Array(nodes.prefix(maxRows - 1))
        let folded = nodes.dropFirst(maxRows - 1)
        return kept + [
            Node(
                id: "\(prefix):more", role: .more(kind), label: "\(folded.count) more",
                amount: folded.reduce(0) { $0 + $1.amount }, categoryIds: folded.flatMap(\.categoryIds), colorHex: nil)
        ]
    }
}

/// Where each row of a `MoneyFlow` sits in a Sankey of a given size: a pure layout, so the
/// geometry is tested without a view (ported from `layoutMoneyFlow` and the design's
/// `sankey.js`). Every band is proportional to its amount; rows that are too thin to read get
/// at least `slot` points of room for their label, and the middle bar is `band` points high.
public struct MoneyFlowLayout: Hashable, Sendable {
    public struct Row: Hashable, Sendable {
        public let id: String
        /// The top of the node's band in its column.
        public let y: Double
        /// The band's thickness (proportional to the amount).
        public let thickness: Double
        /// Where the band meets the middle bar.
        public let middleY: Double
        /// The vertical center of the row's slot, where its label goes.
        public let labelY: Double
        /// The slot the row owns: its label and tap area.
        public let slotTop: Double
        public let slotHeight: Double
    }

    public let height: Double
    public let band: Double
    public let middleTop: Double
    public let sources: [Row]
    public let destinations: [Row]

    /// - Parameters:
    ///   - band: the middle bar's height; bands scale to it.
    ///   - slot: the least room a row takes (its label's height).
    ///   - gap: the space between rows.
    public init(_ flow: MoneyFlow, band: Double, slot: Double, gap: Double) {
        let scale = flow.total > 0 ? band / Double(flow.total) : 0
        func columnHeight(_ nodes: [MoneyFlow.Node]) -> Double {
            nodes.reduce(0) { $0 + max(slot, Double($1.amount) * scale) } + Double(max(0, nodes.count - 1)) * gap
        }
        let height = max(band, columnHeight(flow.sources), columnHeight(flow.destinations))
        let middleTop = (height - band) / 2
        func place(_ nodes: [MoneyFlow.Node]) -> [Row] {
            let column = columnHeight(nodes)
            var y = (height - column) / 2
            var middle = middleTop
            return nodes.map { node in
                let thickness = Double(node.amount) * scale
                let room = max(slot, thickness)
                let row = Row(
                    id: node.id, y: y + (room - thickness) / 2, thickness: thickness, middleY: middle,
                    labelY: y + room / 2, slotTop: y, slotHeight: room)
                y += room + gap
                middle += thickness
                return row
            }
        }
        self.height = height
        self.band = band
        self.middleTop = middleTop
        sources = place(flow.sources)
        destinations = place(flow.destinations)
    }

    /// The row whose slot holds `y` in the left (`source: true`) or right column.
    public func row(at y: Double, source: Bool) -> Row? {
        (source ? sources : destinations).first { y >= $0.slotTop && y <= $0.slotTop + $0.slotHeight }
    }
}

// MARK: - Calendar

/// One month as a Monday-first grid: each day's recorded spending, income and contributions,
/// and what is expected or scheduled on it. Recorded and expected stay separate: a scheduled
/// preview or income dated after today (MAZ-136) is shown as an amber ring, never as money
/// spent or received.
public struct CalendarMonth: Hashable, Sendable {
    public enum Marker: String, CaseIterable, Hashable, Sendable {
        case spent, income, invested, scheduled
    }

    public struct Day: Hashable, Sendable, Identifiable {
        public let date: CalendarDate
        /// Recorded, your share.
        public var spent: Int64 = 0
        public var income: Int64 = 0
        public var invested: Int64 = 0
        /// Recorded entries on this day.
        public var recordedCount = 0
        /// Not in Left to spend yet: scheduled occurrences plus income dated after today (the
        /// amber ring; "expected or scheduled").
        public var scheduledCount = 0
        /// Their net (income minus expenses and contributions).
        public var scheduledNet: Int64 = 0

        public var id: CalendarDate { date }
        /// Income minus spending and contributions, recorded only (the day's header total).
        public var recordedNet: Int64 { income - spent - invested }
        public var isEmpty: Bool { recordedCount == 0 && scheduledCount == 0 }

        public var markers: [Marker] {
            var result: [Marker] = []
            if spent > 0 { result.append(.spent) }
            if income > 0 { result.append(.income) }
            if invested > 0 { result.append(.invested) }
            if scheduledCount > 0 { result.append(.scheduled) }
            return result
        }
    }

    public let month: MonthKey
    /// Blank cells before the 1st (0 when the month starts on a Monday).
    public let leadingBlanks: Int
    public let days: [Day]

    public init(_ summary: MonthSummary) {
        month = summary.month
        leadingBlanks = summary.month.first.mondayBasedWeekday
        let count = CalendarDate.daysInMonth(year: summary.month.year, month: summary.month.month)
        var days = (0..<count).map { Day(date: summary.month.first.adding(days: $0)) }
        for entry in summary.recordedEntries where summary.month.contains(entry.date) {
            let index = entry.date.day - 1
            days[index].recordedCount += 1
            switch entry.kind {
            case .expense: days[index].spent += entry.share
            case .income: days[index].income += entry.share
            case .investment: days[index].invested += entry.share
            }
        }
        // Income dated after today (MAZ-136) is expected like a preview: the amber ring, not a dot.
        for entry in summary.expected + summary.scheduled where summary.month.contains(entry.date) {
            let index = entry.date.day - 1
            days[index].scheduledCount += 1
            days[index].scheduledNet += entry.kind == .income ? entry.share : -entry.share
        }
        self.days = days
    }

    public func day(_ date: CalendarDate) -> Day? {
        guard month.contains(date) else { return nil }
        return days[date.day - 1]
    }

    /// The grid, seven cells a row; nil cells are blanks before the 1st and after the last day.
    public var weeks: [[Day?]] {
        let cells: [Day?] = Array(repeating: nil, count: leadingBlanks) + days.map(Optional.some)
        let padded = cells + Array(repeating: nil, count: (7 - cells.count % 7) % 7)
        return stride(from: 0, to: padded.count, by: 7).map { Array(padded[$0..<$0 + 7]) }
    }

    /// Days with anything on them, for the list the calendar becomes at accessibility sizes.
    public var activeDays: [Day] { days.filter { !$0.isEmpty } }

    /// Average recorded spending per day so far: through `today` in the current month, the
    /// whole month for a past month, nil for a month that has not started.
    public func averageDailySpending(today: CalendarDate) -> Int64? {
        let elapsed: Int
        if today < month.first {
            return nil
        } else if month.contains(today) {
            elapsed = today.day
        } else {
            elapsed = days.count
        }
        let spent = days.reduce(Int64(0)) { $0 + $1.spent }
        return spent / Int64(elapsed)
    }
}

// MARK: - Categories

/// Recorded spending by category for Insights: largest first, with each category's share of
/// the month's spending. Investments and income are not spending and never appear here.
public struct CategoryBreakdown: Hashable, Sendable {
    public struct Row: Hashable, Sendable, Identifiable {
        public let category: LedgerCategory
        public let amount: Int64
        /// "77%", "<1%".
        public let percent: String
        /// 0...1 of the month's spending, for bars.
        public let fraction: Double

        public var id: String { category.id }
    }

    public let rows: [Row]
    /// Recorded spending, your share: the same number as `MonthSummary.recorded.expense`.
    public let total: Int64

    public init(_ summary: MonthSummary) {
        let total = summary.recorded.expense
        self.total = total
        rows = summary.spending.map {
            Row(
                category: $0.category, amount: $0.amount, percent: Percent.text($0.amount, of: total) ?? "",
                fraction: total > 0 ? Double($0.amount) / Double(total) : 0)
        }
    }

    public var isEmpty: Bool { rows.isEmpty }
}

/// This month's recorded spending against the month before it.
public struct MonthComparison: Hashable, Sendable {
    public let current: Int64
    public let previous: Int64
    public let previousMonth: MonthKey?

    /// Positive when more was spent this month.
    public var difference: Int64 { current - previous }

    public init(current: MonthSummary, previous: MonthSummary?) {
        self.current = current.recorded.expense
        self.previous = previous?.recorded.expense ?? 0
        previousMonth = previous?.month
    }
}

extension LedgerReport {
    /// The month's spending compared with the previous month's. A month before the ledger's
    /// range compares with nothing.
    public func comparison(_ summary: MonthSummary) -> MonthComparison {
        MonthComparison(current: summary, previous: summary.month.shifted(by: -1).map { month($0) })
    }

    /// The month's entries in one category (recorded and scheduled, newest first). The month's
    /// totals do not change: this is a filter of the list, like `monthEntries`.
    public func categoryEntries(_ summary: MonthSummary, categoryIds: [String]) -> [ReportEntry] {
        let ids = Set(categoryIds)
        return (summary.recordedEntries + summary.scheduled).filter { ids.contains($0.categoryId) }
            .sorted(by: ReportEntry.newestFirst)
    }
}
