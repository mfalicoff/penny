import PennyDomain
import Testing

@Suite("Activity with shared expenses (MAZ-185)")
struct ActivitySharedRowsTests {
    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest)

    static func share(
        _ id: String, _ date: String, share: Int64, category: String = "Groceries", currency: Currency = .cad
    ) -> SharedExpenseShare {
        SharedExpenseShare(
            id: id, householdId: "maison", currency: currency, title: "Shared \(id)", date: .day(date),
            total: share * 2, share: share, category: .init(name: category, icon: "basket-outline", color: "#0FA3A3"),
            householdName: "Maison")
    }

    static func report(shared: [SharedExpenseShare]) -> LedgerReport {
        LedgerReport(
            ledger: Ledger(
                accounts: [Sample.visa],
                transactions: [
                    Sample.entry("coffee", "2026-11-04", share: 500, category: "food"),
                    Sample.entry("market", "2026-11-03", share: 2000, category: "groceries"),
                    Sample.entry("pay", "2026-11-01", share: 300_000, kind: .income, category: "salary"),
                ]),
            shared: shared)
    }

    @Test("whenBrowsing_Activity_ShouldListSharedRowsByDayAndCountTheShareInTotals")
    func listsAndCounts() {
        let report = Self.report(shared: [Self.share("e1", "2026-11-03", share: 3000)])
        let result = report.activity(ActivityFilters(period: .month(Self.november)), index: FoldedSearchIndex())
        #expect(result.entries.map(\.id) == ["coffee", "household:maison:e1", "market", "pay"])
        let shared = result.entries[1]
        #expect(shared.source == .shared(householdId: "maison", expenseId: "e1"))
        #expect(shared.householdName == "Maison")
        #expect(shared.share == 3000, "the viewer's share, never the total")
        #expect(result.summary.expense == 5500, "personal 2,500 plus the 3,000 share, as Home counts it")
        let days = ActivityDay.group(result.entries)
        #expect(days.first { $0.date == .day("2026-11-03") }?.net == -5000)
        #expect(result.entries.first { $0.source == .personal }?.householdName == nil)
    }

    @Test("whenFiltered_Activity_ShouldMatchSharedRowsByKindPeriodDayAndCategoryName")
    func filters() {
        let report = Self.report(shared: [
            Self.share("e1", "2026-11-03", share: 3000),
            Self.share("e2", "2026-11-05", share: 1000, category: "Home"),
            Self.share("old", "2026-10-30", share: 700),
        ])
        func ids(_ filters: ActivityFilters) -> [String] {
            report.activity(filters, index: FoldedSearchIndex()).entries.map(\.id)
        }
        let month = ActivityFilters.Period.month(Self.november)
        #expect(!ids(ActivityFilters(period: month)).contains("household:maison:old"), "another month's row")
        #expect(
            ids(ActivityFilters(period: month, kind: .expense, categoryId: "groceries"))
                == ["household:maison:e1", "market"], "a personal category matches a shared one by name")
        #expect(ids(ActivityFilters(period: month, kind: .expense, categoryId: "food")) == ["coffee"])
        #expect(ids(ActivityFilters(period: month, kind: .income)) == ["pay"], "shared rows are expenses")
        #expect(
            ids(ActivityFilters(period: month, day: .day("2026-11-05"))) == ["household:maison:e2"])
        #expect(ids(ActivityFilters(period: .year(2026))).contains("household:maison:old"))
    }

    @Test("whenASharedRowIsInAnotherCurrency_Activity_ShouldLeaveItOutOfRowsAndTotals")
    func otherCurrency() {
        let report = Self.report(shared: [Self.share("eur", "2026-11-03", share: 3000, currency: .eur)])
        let result = report.activity(ActivityFilters(period: .month(Self.november)), index: FoldedSearchIndex())
        #expect(!result.entries.contains { $0.source != .personal })
        #expect(result.summary.expense == 2500)
    }

    @Test("whenTheCategoryIsUnknown_MatchesCategory_ShouldNotMatchASharedRow")
    func unknownCategory() {
        let report = Self.report(shared: [Self.share("e1", "2026-11-03", share: 3000)])
        let shared = report.recorded.first { $0.source != .personal }
        #expect(shared.map { report.matchesCategory($0, nil) } == true)
        #expect(shared.map { report.matchesCategory($0, "missing") } == false)
        #expect(shared.map { report.matchesCategory($0, "food") } == false)
    }
}
