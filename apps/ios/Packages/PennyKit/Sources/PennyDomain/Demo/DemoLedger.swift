/// The sample ledger behind "Try with sample data". It is made up,
/// built fresh for each demo and dated around `today`, so the demo always shows a current
/// month. Last month has a few entries too, so the demo has a monthly recap (MAZ-292) and
/// Insights has a month to compare with. Ids start with `demo-`, so a demo record is
/// recognizable if one ever leaked.
///
/// The demo is temporary and isolated: it never touches an account's data, never reaches a
/// server and is gone when the demo ends (docs/ios/shell.md, "Demo").
public enum DemoLedger {
    public static let idPrefix = "demo-"

    public static func make(today: CalendarDate) -> Ledger {
        let month = MonthKey(today)
        func day(_ offset: Int) -> CalendarDate { month.first.adding(days: max(0, today.day - 1 - offset)) }
        var count = 0
        func entry(
            _ title: String, _ cents: Int64, _ category: String, daysAgo: Int, share: Int64? = nil,
            kind: EntryKind = .expense, account: String? = "demo-chequing", trip: String? = nil,
            participants: Int? = nil
        ) -> LedgerEntry {
            count += 1
            return LedgerEntry(
                id: "\(idPrefix)entry-\(count)", title: title, kind: kind, total: cents, share: share ?? cents,
                participants: participants,
                categoryId: category, accountId: account, tripId: trip, date: day(daysAgo))
        }
        // Last month, on fixed days: a recap with category changes, a split and quiet days.
        var lastCount = 0
        func previous(
            _ title: String, _ cents: Int64, _ category: String, day: Int, share: Int64? = nil,
            kind: EntryKind = .expense, account: String = "demo-chequing", participants: Int? = nil,
            trip: String? = nil
        ) -> LedgerEntry? {
            guard let last = month.shifted(by: -1) else { return nil }
            lastCount += 1
            return LedgerEntry(
                id: "\(idPrefix)last-\(lastCount)", title: title, kind: kind, total: cents, share: share ?? cents,
                participants: participants, categoryId: category, accountId: account, tripId: trip,
                date: last.first.adding(days: day - 1))
        }
        let lastMonth = [
            previous("Monthly salary", 480_000, "salary", day: 1, kind: .income),
            previous("Rent", 145_000, "home", day: 1),
            previous("Monthly transit pass", 15_600, "transport", day: 2),
            previous("Music streaming", 1_299, "fun", day: 3, account: "demo-visa"),
            previous("Weekly groceries", 9_120, "groceries", day: 4),
            previous(
                "Dinner out", 11_200, "food", day: 9, share: 5_600, account: "demo-visa", participants: 2,
                trip: "demo-trip-city"),
            previous("Index fund", 20_000, "investments", day: 15, kind: .investment),
            previous("Weekend groceries", 6_830, "groceries", day: 18),
            previous("New shoes", 8_999, "shopping", day: 24, account: "demo-visa"),
        ].compactMap { $0 }
        let nextMonth = month.shifted(by: 1)?.first ?? month.last
        let tripStart = month.first
        // Last month's city break, so the year in review (MAZ-292) has two trips to compare.
        let cityBreak = month.shifted(by: -1)?.first.adding(days: 7)
        return Ledger(
            currency: .cad,
            accounts: [
                PaymentAccount(id: "demo-chequing", name: "Main chequing", type: .bank),
                PaymentAccount(id: "demo-visa", name: "Visa", type: .credit),
            ],
            trips: [
                Trip(id: "demo-trip", name: "Weekend away", startDate: tripStart, endDate: tripStart.adding(days: 2))
            ]
                + (cityBreak.map {
                    [Trip(id: "demo-trip-city", name: "City break", startDate: $0, endDate: $0.adding(days: 3))]
                } ?? []),
            categories: Ledger.defaultCategories,
            transactions: [
                entry("Monthly salary", 480_000, "salary", daysAgo: 20, kind: .income),
                entry("Rent", 145_000, "home", daysAgo: 20),
                entry("Weekly groceries", 8_642, "groceries", daysAgo: 0),
                entry(
                    "Coffee with a friend", 1_240, "food", daysAgo: 0, share: 620, account: "demo-visa", participants: 2
                ),
                entry("Dinner out", 14_880, "food", daysAgo: 1, share: 7_440, account: "demo-visa", participants: 2),
                entry("Monthly transit pass", 15_600, "transport", daysAgo: 5),
                entry("A new book", 2_499, "shopping", daysAgo: 2, account: "demo-visa", trip: "demo-trip"),
                entry("Weekend groceries", 7_235, "groceries", daysAgo: 6),
                entry("Design project", 65_000, "freelance", daysAgo: 8, kind: .income),
                entry("Index fund", 20_000, "investments", daysAgo: 3, kind: .investment),
                entry("Music streaming", 1_299, "fun", daysAgo: 3, account: "demo-visa"),
            ] + lastMonth,
            recurring: [
                RecurringRule(
                    id: "demo-rule-salary", title: "Monthly salary", kind: .income, total: 480_000, share: 480_000,
                    categoryId: "salary", accountId: "demo-chequing", date: month.first, frequency: .monthly,
                    nextDate: nextMonth, anchorDay: 1),
                RecurringRule(
                    id: "demo-rule-rent", title: "Rent", kind: .expense, total: 145_000, share: 145_000,
                    categoryId: "home", accountId: "demo-chequing", date: month.first, frequency: .monthly,
                    nextDate: nextMonth, anchorDay: 1),
            ])
    }
}
