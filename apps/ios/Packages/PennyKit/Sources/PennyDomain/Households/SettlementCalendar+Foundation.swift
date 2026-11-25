public import Foundation

extension SettlementCalendar {
    /// Whether `month` takes monthly payments at the instant `now`, read on the UTC calendar day
    /// the server settles on. Pass the app's clock (`AppServices.now`), never `Date()`: UI tests
    /// and captures pin it to the test server's clock, so the app offers Record paid only when
    /// the server would accept it.
    public static func monthlyPaymentsOpen(_ month: MonthKey, at now: Date) -> Bool {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return monthlyPaymentsOpen(month, todayUTC: CalendarDate(now, in: utc))
    }
}
