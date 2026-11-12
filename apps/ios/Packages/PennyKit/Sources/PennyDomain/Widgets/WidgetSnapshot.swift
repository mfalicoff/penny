public import Foundation

/// What the Home Screen widgets show (MAZ-80, docs/ios-widgets.md): a small, derived summary of
/// one month that the app writes to the App Group and the widget extension reads. It holds only
/// what the two widgets draw, never the ledger, ids, notes, accounts, the server or the email.
///
/// Every number comes from `LedgerReport.month`, the same rules as Home: **Left to spend** is
/// recorded only, **Projected** adds scheduled occurrences and income dated after today, and
/// shared household rows count once, at the viewer's share. The widgets never compute money.
public struct WidgetSnapshot: Codable, Hashable, Sendable {
    /// One recent expense row.
    public struct Expense: Codable, Hashable, Sendable {
        public var title: String
        /// The viewer's share, in cents.
        public var cents: Int64
        public var date: String
        /// A household expense (the viewer's share of it).
        public var shared: Bool

        public init(title: String, cents: Int64, date: String, shared: Bool) {
            self.title = title
            self.cents = cents
            self.date = date
            self.shared = shared
        }
    }

    /// The most recent expenses kept: what a small widget shows.
    public static let maxRecentExpenses = 3
    /// Longer titles are cut here; the widget truncates them further on screen.
    public static let maxTitleLength = 60

    /// The month summarized, `yyyy-MM`. The widget shows the snapshot as out of date once the
    /// device's month is past it.
    public var month: String
    /// ISO 4217 code of the ledger's currency.
    public var currency: String
    /// When the app built this snapshot.
    public var generatedAt: Date
    /// Recorded income, expenses and contributions of the month (your share).
    public var income: Int64
    public var spent: Int64
    public var invested: Int64
    /// Left to spend: recorded income minus recorded expenses and contributions, signed.
    public var leftToSpend: Int64
    /// Projected remaining: recorded plus every scheduled occurrence and expected income, signed.
    public var projectedRemaining: Int64
    /// Newest first: at most `maxRecentExpenses` recorded expenses dated today or earlier.
    public var recentExpenses: [Expense]
    /// Changes made on this device have not reached the server yet (offline or failing), so
    /// the numbers are "as of last sync" for anything changed elsewhere.
    public var waitingToSync: Bool

    public init(
        month: String, currency: String, generatedAt: Date, income: Int64, spent: Int64, invested: Int64,
        leftToSpend: Int64, projectedRemaining: Int64, recentExpenses: [Expense], waitingToSync: Bool
    ) {
        self.month = month
        self.currency = currency
        self.generatedAt = generatedAt
        self.income = income
        self.spent = spent
        self.invested = invested
        self.leftToSpend = leftToSpend
        self.projectedRemaining = projectedRemaining
        self.recentExpenses = recentExpenses
        self.waitingToSync = waitingToSync
    }

    /// Nothing recorded in the month yet.
    public var isEmptyMonth: Bool { income == 0 && spent == 0 && invested == 0 }

    /// The snapshot of `today`'s month.
    ///
    /// - Parameters:
    ///   - report: the personal ledger joined with the shared shares (`ShellModel.report`).
    ///   - currency: the ledger's currency.
    ///   - today: the person's local date; income dated after it is expected, not recorded.
    ///   - now: the build time stored in the snapshot.
    ///   - waitingToSync: whether this device has changes the server has not acknowledged.
    public init(
        report: LedgerReport, currency: Currency, today: CalendarDate, now: Date, waitingToSync: Bool = false
    ) {
        let month = MonthKey(today)
        let summary = report.month(month, today: today)
        let recent = report.recorded
            .filter { $0.kind == .expense && !$0.scheduled && $0.date <= today }
            .sorted(by: ReportEntry.newestFirst)
            .prefix(Self.maxRecentExpenses)
            .map {
                Expense(
                    title: String($0.title.prefix(Self.maxTitleLength)), cents: $0.share, date: $0.date.description,
                    shared: $0.source != .personal)
            }
        self.init(
            month: month.description, currency: currency.rawValue, generatedAt: now,
            income: summary.recorded.income, spent: summary.recorded.expense, invested: summary.recorded.investment,
            leftToSpend: summary.recordedRemaining, projectedRemaining: summary.projectedRemaining,
            recentExpenses: Array(recent), waitingToSync: waitingToSync)
    }

    /// Equal apart from when it was built: the app skips rewriting (and reloading the widgets)
    /// when nothing the widgets show has changed.
    public func sameContent(as other: WidgetSnapshot) -> Bool {
        var other = other
        other.generatedAt = generatedAt
        return self == other
    }
}
