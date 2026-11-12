import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Widget snapshot: the month the widgets show")
struct WidgetSnapshotTests {
    static let built = Date(timeIntervalSince1970: 1_794_000_000)

    @Test("whenSeededHousehold_WidgetSnapshot_ShouldMatchRedesignRecordedAndProjectedTotals")
    func goldenTotals() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["alex-2026-10"])
        let (scenario, ledger) = try ContractLedger.alexSeed()
        let october = try #require(ReportTests.october)
        let report = LedgerReport(
            ledger: ledger, shared: try ReportTests.alexShared(scenario),
            sharedScheduled: try ReportTests.alexSharedScheduled(scenario, through: october))
        let today = october.last

        let snapshot = WidgetSnapshot(report: report, currency: ledger.currency, today: today, now: Self.built)
        let summary = report.month(october, today: today)

        // The same numbers as Home: recorded totals from the fixture, Left to spend recorded
        // only, Projected separate.
        #expect(snapshot.month == "2026-10")
        #expect(snapshot.income == expected.recorded.incomeCents)
        #expect(snapshot.spent == expected.recorded.expenseCents)
        #expect(snapshot.invested == expected.recorded.investmentCents)
        #expect(
            snapshot.leftToSpend
                == expected.recorded.incomeCents - expected.recorded.expenseCents - expected.recorded.investmentCents)
        #expect(snapshot.leftToSpend == summary.recordedRemaining)
        #expect(snapshot.projectedRemaining == summary.projectedRemaining)
        #expect(snapshot.currency == ledger.currency.rawValue)
        #expect(snapshot.generatedAt == Self.built)
        // Shared rows are the viewer's share, marked shared.
        #expect(snapshot.recentExpenses.count <= WidgetSnapshot.maxRecentExpenses)
        #expect(snapshot.recentExpenses.map(\.date) == snapshot.recentExpenses.map(\.date).sorted(by: >))
    }

    @Test("whenEntriesAreScheduledFutureOrIncome_WidgetSnapshot_ShouldListOnlyRecordedPastExpensesNewestFirst")
    func recentExpenses() throws {
        let today = CalendarDate.day("2026-11-10")
        let ledger = Sample.ledger(
            transactions: [
                Sample.entry("a", "2026-11-01", share: 100, title: "Oldest"),
                Sample.entry("b", "2026-11-09", share: 200, title: "Bakery"),
                Sample.entry("c", "2026-11-10", share: 300, title: "Coffee"),
                Sample.entry("d", "2026-11-10", share: 400, title: "Dinner"),
                Sample.entry("future", "2026-11-20", share: 500, title: "Booked"),
                Sample.entry("pay", "2026-11-05", share: 900_000, kind: .income, title: "Pay"),
                Sample.entry("october", "2026-10-31", share: 50, title: "Last month"),
            ],
            recurring: [Sample.rule("rent", start: "2026-11-15", share: 150_000)])
        let shared = SharedExpenseShare(
            id: "e1", householdId: "maison", currency: .cad, title: "Groceries", date: .day("2026-11-10"),
            total: 9000, share: 3000, category: .init(name: "Groceries", icon: "basket-outline", color: "#0FA3A3"))
        let report = LedgerReport(ledger: ledger, shared: [shared])

        let snapshot = WidgetSnapshot(report: report, currency: .cad, today: today, now: Self.built)

        // Same day: id order (ordinal), shared row id `household:maison:e1` sorts first.
        #expect(snapshot.recentExpenses.map(\.title) == ["Coffee", "Dinner", "Groceries"])
        #expect(snapshot.recentExpenses.map(\.cents) == [300, 400, 3000])
        #expect(snapshot.recentExpenses.map(\.shared) == [false, false, true])
        // The future-dated expense is recorded (MAZ-139) but not "recent"; the rent preview is
        // only projected.
        #expect(snapshot.spent == 100 + 200 + 300 + 400 + 500 + 3000)
        #expect(snapshot.leftToSpend == 900_000 - snapshot.spent)
        #expect(snapshot.projectedRemaining == snapshot.leftToSpend - 150_000)
        #expect(!snapshot.isEmptyMonth)
    }

    @Test("whenIncomeIsDatedAfterToday_WidgetSnapshot_ShouldCountItAsProjectedNotLeftToSpend")
    func expectedIncome() {
        let ledger = Sample.ledger(transactions: [
            Sample.entry("pay", "2026-11-25", share: 200_000, kind: .income, title: "Pay"),
            Sample.entry("x", "2026-11-02", share: 1000),
        ])
        let snapshot = WidgetSnapshot(
            report: LedgerReport(ledger: ledger), currency: .cad, today: .day("2026-11-10"), now: Self.built)
        #expect(snapshot.income == 0)
        #expect(snapshot.leftToSpend == -1000)
        #expect(snapshot.projectedRemaining == 199_000)
    }

    @Test("whenNothingRecordedThisMonth_WidgetSnapshot_ShouldBeAnEmptyMonth")
    func emptyMonth() {
        let ledger = Sample.ledger(transactions: [Sample.entry("old", "2026-10-02", share: 500)])
        let snapshot = WidgetSnapshot(
            report: LedgerReport(ledger: ledger), currency: .eur, today: .day("2026-11-01"), now: Self.built)
        #expect(snapshot.isEmptyMonth)
        #expect(snapshot.leftToSpend == 0)
        #expect(snapshot.currency == "EUR")
        // Last month's expense is still the most recent one.
        #expect(snapshot.recentExpenses.map(\.cents) == [500])
    }

    @Test("whenTitleIsLong_WidgetSnapshot_ShouldKeepAtMostTheTitleLimit")
    func longTitle() {
        let title = String(repeating: "Très long titre ", count: 20)
        let ledger = Sample.ledger(transactions: [Sample.entry("a", "2026-11-02", title: title)])
        let snapshot = WidgetSnapshot(
            report: LedgerReport(ledger: ledger), currency: .cad, today: .day("2026-11-10"), now: Self.built)
        #expect(snapshot.recentExpenses.first?.title.count == WidgetSnapshot.maxTitleLength)
    }

    @Test("whenOnlyBuildTimeDiffers_WidgetSnapshot_ShouldHaveSameContent")
    func sameContent() {
        let ledger = Sample.ledger(transactions: [Sample.entry("a", "2026-11-02")])
        let report = LedgerReport(ledger: ledger)
        let first = WidgetSnapshot(report: report, currency: .cad, today: .day("2026-11-10"), now: Self.built)
        let later = WidgetSnapshot(
            report: report, currency: .cad, today: .day("2026-11-10"), now: Self.built.addingTimeInterval(60))
        #expect(first.sameContent(as: later))
        #expect(first != later)
        let waiting = WidgetSnapshot(
            report: report, currency: .cad, today: .day("2026-11-10"), now: Self.built, waitingToSync: true)
        #expect(!first.sameContent(as: waiting))
    }
}
