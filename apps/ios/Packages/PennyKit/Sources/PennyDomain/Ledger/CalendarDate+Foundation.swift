public import Foundation

extension CalendarDate {
    /// The calendar day `date` falls on in `calendar`'s time zone: how a client gets "today"
    /// for materializing recurrence (the device's local date). This is
    /// the only place an instant becomes a ledger date. A non-Gregorian calendar is converted
    /// through the Gregorian one, so a Buddhist or Japanese device calendar names the same day.
    public init(_ date: Date, in calendar: Calendar = .current) {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        let parts = gregorian.dateComponents([.year, .month, .day], from: date)
        let fallback = CalendarDate.earliest
        self =
            CalendarDate(year: parts.year ?? fallback.year, month: parts.month ?? 1, day: parts.day ?? 1) ?? fallback
    }
}
