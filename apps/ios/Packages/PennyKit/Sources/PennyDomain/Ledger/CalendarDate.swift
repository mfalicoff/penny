/// A calendar date without a time zone, the way the ledger stores one ("2026-01-31").
///
/// Ledger dates are wall-clock days: they never carry an instant, so no time zone, DST
/// change or device calendar can move them. All arithmetic here is proleptic Gregorian
/// and pure integer math, so it behaves the same on every platform and never touches
/// `Calendar`. Ordering is chronological, and equals the lexicographic order of the
/// `YYYY-MM-DD` text, which is how the legacy app compared dates.
public struct CalendarDate: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    /// The first and last dates the ledger accepts (docs/migration/ledger.md).
    public static let earliest = CalendarDate(uncheckedYear: 2000, month: 1, day: 1)
    public static let latest = CalendarDate(uncheckedYear: 2100, month: 12, day: 31)

    private init(uncheckedYear year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// A real calendar day in years 0 through 9999, or nil. Ledger range is a separate
    /// rule: see ``isWithinLedgerRange``.
    public init?(year: Int, month: Int, day: Int) {
        guard (0...9999).contains(year), (1...12).contains(month),
            (1...CalendarDate.daysInMonth(year: year, month: month)).contains(day)
        else { return nil }
        self.init(uncheckedYear: year, month: month, day: day)
    }

    /// Strict `YYYY-MM-DD`: exactly ten ASCII characters (no sign, spaces or non-ASCII
    /// digits) naming a real day. Matches the wire format's pattern plus calendar validity.
    public init?(_ text: String) {
        let bytes = Array(text.utf8)
        guard bytes.count == 10, bytes[4] == 0x2D, bytes[7] == 0x2D else { return nil }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for byte in bytes[range] {
                guard (0x30...0x39).contains(byte) else { return nil }
                value = value * 10 + Int(byte - 0x30)
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10) else { return nil }
        self.init(year: year, month: month, day: day)
    }

    /// True for a ledger date: a real day from 2000-01-01 through 2100-12-31.
    public var isWithinLedgerRange: Bool { self >= .earliest && self <= .latest }

    /// A strict ledger date string, or nil when it is malformed, not a real day or out of range.
    public static func ledgerDate(_ text: String) -> CalendarDate? {
        guard let date = CalendarDate(text), date.isWithinLedgerRange else { return nil }
        return date
    }

    public var description: String {
        func pad(_ value: Int, _ width: Int) -> String {
            let text = String(value)
            return String(repeating: "0", count: max(0, width - text.count)) + text
        }
        return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))"
    }

    /// The `YYYY-MM` prefix used to select a month.
    public var monthKey: String { String(description.prefix(7)) }

    public static func < (lhs: CalendarDate, rhs: CalendarDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    // MARK: Calendar arithmetic

    public static func isLeapYear(_ year: Int) -> Bool {
        (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
    }

    public static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 2: isLeapYear(year) ? 29 : 28
        case 4, 6, 9, 11: 30
        default: 31
        }
    }

    /// Days since 1970-01-01 (Howard Hinnant's civil-days algorithm).
    var epochDay: Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    init(epochDay: Int) {
        let z = epochDay + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        let year = yoe + era * 400 + (month <= 2 ? 1 : 0)
        self.init(uncheckedYear: year, month: month, day: day)
    }

    /// The date `days` later (or earlier when negative).
    public func adding(days: Int) -> CalendarDate { CalendarDate(epochDay: epochDay + days) }

    /// Whole days from `other` to this date.
    public func days(since other: CalendarDate) -> Int { epochDay - other.epochDay }

    /// Monday-based weekday offset, 0 = Monday ... 6 = Sunday (the calendar grid's column).
    public var mondayBasedWeekday: Int { ((epochDay + 3) % 7 + 7) % 7 }

    /// The date `months` calendar months later with its day set to `min(day, lastDayOfThatMonth)`.
    /// The day is a parameter rather than `self.day` so a recurrence can keep its anchor.
    public func addingMonths(_ months: Int, day targetDay: Int) -> CalendarDate {
        let index = year * 12 + (month - 1) + months
        let newYear = index >= 0 ? index / 12 : -((-index + 11) / 12)
        let newMonth = index - newYear * 12 + 1
        let last = CalendarDate.daysInMonth(year: newYear, month: newMonth)
        return CalendarDate(uncheckedYear: newYear, month: newMonth, day: min(max(1, targetDay), last))
    }
}
