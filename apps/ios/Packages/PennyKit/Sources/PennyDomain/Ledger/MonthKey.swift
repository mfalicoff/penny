/// A calendar month, "YYYY-MM", within the ledger range 2000-01 through 2100-12.
public struct MonthKey: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int

    public init?(year: Int, month: Int) {
        guard (2000...2100).contains(year), (1...12).contains(month) else { return nil }
        self.year = year
        self.month = month
    }

    /// Strict "YYYY-MM" with ASCII digits.
    public init?(_ text: String) {
        guard text.utf8.count == 7, let date = CalendarDate.ledgerDate(text + "-01") else { return nil }
        self.init(year: date.year, month: date.month)
    }

    public init(_ date: CalendarDate) {
        // Ledger dates are within 2000...2100, so this cannot fail for them; clamp otherwise.
        self.year = min(max(date.year, 2000), 2100)
        self.month = date.month
    }

    public var first: CalendarDate { CalendarDate(year: year, month: month, day: 1) ?? .earliest }
    public var last: CalendarDate {
        CalendarDate(year: year, month: month, day: CalendarDate.daysInMonth(year: year, month: month)) ?? .latest
    }

    public func contains(_ date: CalendarDate) -> Bool { date.year == year && date.month == month }

    /// The month `delta` months away, or nil outside the ledger range.
    public func shifted(by delta: Int) -> MonthKey? {
        let index = year * 12 + (month - 1) + delta
        return MonthKey(year: index / 12, month: index % 12 + 1)
    }

    public var description: String { first.monthKey }

    public static func < (lhs: MonthKey, rhs: MonthKey) -> Bool { (lhs.year, lhs.month) < (rhs.year, rhs.month) }
}
