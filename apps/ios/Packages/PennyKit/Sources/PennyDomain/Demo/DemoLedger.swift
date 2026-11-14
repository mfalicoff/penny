/// The sample ledger behind "Try with sample data". It is made up,
/// built fresh for each demo and dated around `today`, so the demo always shows a current
/// month. Ids start with `demo-`, so a demo record is recognizable if one ever leaked.
///
/// The demo is temporary and isolated: it never touches an account's data, never reaches a
/// server and is gone when the demo ends (docs/ios-shell.md, "Demo").
public enum DemoLedger {
    public static let idPrefix = "demo-"

    public static func make(today: CalendarDate) -> Ledger {
        let month = MonthKey(today)
        func day(_ offset: Int) -> CalendarDate { month.first.adding(days: max(0, today.day - 1 - offset)) }
        var count = 0
        func entry(
            _ title: String, _ cents: Int64, _ category: String, daysAgo: Int, share: Int64? = nil,
            kind: EntryKind = .expense, account: String? = "demo-chequing", trip: String? = nil
        ) -> LedgerEntry {
            count += 1
            return LedgerEntry(
                id: "\(idPrefix)entry-\(count)", title: title, kind: kind, total: cents, share: share ?? cents,
                categoryId: category, accountId: account, tripId: trip, date: day(daysAgo))
        }
        let nextMonth = month.shifted(by: 1)?.first ?? month.last
        let tripStart = month.first
        return Ledger(
            currency: .cad,
            accounts: [
                PaymentAccount(id: "demo-chequing", name: "Main chequing", type: .bank),
                PaymentAccount(id: "demo-visa", name: "Visa", type: .credit),
            ],
            trips: [
                Trip(id: "demo-trip", name: "Weekend away", startDate: tripStart, endDate: tripStart.adding(days: 2))
            ],
            categories: Ledger.defaultCategories,
            transactions: [
                entry("Monthly salary", 480_000, "salary", daysAgo: 20, kind: .income),
                entry("Rent", 145_000, "home", daysAgo: 20),
                entry("Weekly groceries", 8_642, "groceries", daysAgo: 0),
                entry("Coffee with a friend", 1_240, "food", daysAgo: 0, share: 620, account: "demo-visa"),
                entry("Dinner out", 14_880, "food", daysAgo: 1, share: 7_440, account: "demo-visa"),
                entry("Monthly transit pass", 15_600, "transport", daysAgo: 5),
                entry("A new book", 2_499, "shopping", daysAgo: 2, account: "demo-visa", trip: "demo-trip"),
                entry("Weekend groceries", 7_235, "groceries", daysAgo: 6),
                entry("Design project", 65_000, "freelance", daysAgo: 8, kind: .income),
                entry("Index fund", 20_000, "investments", daysAgo: 3, kind: .investment),
                entry("Music streaming", 1_299, "fun", daysAgo: 3, account: "demo-visa"),
            ],
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
