import Foundation
import PennyData
import PennyDomain
import SwiftUI
import Testing

@testable import PennyUI

/// One fixed projection for every month (also used by WidgetPublisherTests).
struct FixedProjection: SharedProjectionService {
    let answer: WireHouseholdProjection
    func projection(month: MonthKey) async throws -> WireHouseholdProjection { answer }
}

@Suite("Home overview, money flow, Insights and calendar")
@MainActor
struct OverviewViewTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    private func entry(
        _ id: String, _ date: String, _ share: Int64, kind: EntryKind = .expense, category: String = "food"
    ) -> LedgerEntry {
        LedgerEntry(
            id: id, title: "Entry \(id)", kind: kind, total: share, share: share, categoryId: category,
            date: CalendarDate(date) ?? .earliest)
    }

    private func shell(_ ledger: Ledger, projection: WireHouseholdProjection? = nil) -> ShellModel {
        ShellModel(
            workspace: FixedWorkspace(load: .ready(ledger)), session: .demo, today: today,
            sharedProjection: projection.map { FixedProjection(answer: $0) })
    }

    private static func projection() throws -> WireHouseholdProjection {
        let row = #"""
            {"id":"e1","householdId":"maison","householdCurrency":"CAD","title":"Groceries","date":"2026-11-03",
             "totalCents":9000,"shareCents":3000,"payerUserId":"u","note":"",
             "category":{"name":"Groceries","icon":"basket-outline","color":"#0FA3A3"}}
            """#
        return try JSONDecoder().decode(
            WireHouseholdProjection.self, from: Data(#"{"transactions":[\#(row)],"scheduled":[]}"#.utf8))
    }

    @Test("whenTheHouseholdProjectionLoads_ShellModel_ShouldAddTheViewersShareOnceAndCacheTheReport")
    func sharedReport() async throws {
        let ledger = Ledger(transactions: [entry("p1", "2026-11-02", 2500)])
        let shell = shell(ledger, projection: try Self.projection())
        #expect(shell.report(ledger).month(shell.month).recorded.expense == 2500)
        await shell.refreshShared()
        let report = shell.report(ledger)
        #expect(report.month(shell.month).recorded.expense == 5500, "2,500 personal + 3,000 shared share")
        // The same ledger and answers give the cached report.
        #expect(shell.report(ledger).recorded == report.recorded)
        let changed = Ledger(transactions: ledger.transactions + [entry("p2", "2026-11-04", 100)])
        #expect(shell.report(changed).month(shell.month).recorded.expense == 5600)
    }

    @Test("whenInTheDemo_ShellModel_ShouldNeverAskForSharedRows")
    func demoHasNoShared() async throws {
        let demo = DemoWorkspace(today: today)
        let shell = ShellModel(
            workspace: demo, session: .demo, today: today,
            sharedProjection: FixedProjection(answer: try Self.projection()))
        await shell.refreshShared()
        #expect(!shell.shared.isAvailable)
        #expect(shell.shared.status(for: shell.month) == .idle)
    }

    @Test("whenADayIsChosen_Calendar_ShouldFilterTheListButNotTheMonthsTotals")
    func filterIndependence() throws {
        let ledger = Ledger(transactions: [
            entry("a", "2026-11-02", 1000), entry("b", "2026-11-06", 6200),
            entry("c", "2026-11-06", 20_000, kind: .investment, category: "investments"),
        ])
        let report = LedgerReport(ledger: ledger)
        let month = MonthKey(today)
        let summary = report.month(month)
        let day = try #require(CalendarDate("2026-11-06"))
        #expect(CalendarView.selectedDay(day, month: month, today: today) == day)
        #expect(CalendarView.selectedDay(nil, month: month, today: today) == today)
        let october = try #require(month.shifted(by: -1))
        #expect(CalendarView.selectedDay(day, month: october, today: today) == nil, "another month has no selection")
        #expect(report.monthEntries(summary, day: day).map(\.id).sorted() == ["b", "c"])
        #expect(report.month(month) == summary, "choosing a day never changes the totals")
        #expect(CalendarMonth(summary).day(day)?.recordedNet == -26_200)
    }

    @Test("whenSpoken_OverviewText_ShouldNameEveryValueInWords")
    func voiceOverSummaries() throws {
        let ledger = Ledger(transactions: [
            entry("pay", "2026-11-01", 320_000, kind: .income, category: "salary"),
            entry("rent", "2026-11-02", 145_000, category: "home"),
            entry("etf", "2026-11-06", 20_000, kind: .investment, category: "investments"),
        ])
        let report = LedgerReport(ledger: ledger)
        let summary = report.month(MonthKey(today))
        let flow = MoneyFlow(summary, categories: report.categories)
        let text = OverviewText.flowSummary(flow, currency: "CAD")
        #expect(text.contains("Came in"))
        #expect(text.contains("left over"))
        let rent = try #require(flow.node(id: "expense:home"))
        let spoken = OverviewText.flowNode(rent, in: flow, currency: "CAD")
        #expect(spoken.hasPrefix("Home, "))
        #expect(spoken.contains("went out"))
        #expect(spoken.contains("45% of income"))
        #expect(spoken.contains("100% of spending"))
        let invested = try #require(flow.node(id: "investment:total"))
        #expect(OverviewText.flowShares(invested, in: flow).contains("not spending"))
        let day = try #require(CalendarMonth(summary).day(CalendarDate("2026-11-06") ?? .earliest))
        let label = OverviewText.calendarDay(day, currency: "CAD", today: today)
        #expect(label.contains("invested"))
        #expect(!label.contains("spent"))
        #expect(OverviewText.identifier("expense:food") == "expense-food")
        #expect(OverviewText.identifier("a_b-C9") == "a_b-C9")
    }

    @Test("whenComparingMonths_Insights_ShouldSaySpendingWentUpOrDownInWords")
    func comparisonSentence() throws {
        let report = LedgerReport(
            ledger: Ledger(transactions: [entry("oct", "2026-10-10", 230_000), entry("nov", "2026-11-10", 188_800)]))
        let summary = report.month(MonthKey(today))
        let sentence = OverviewText.comparison(report.comparison(summary), currency: "CAD")
        #expect(sentence.hasSuffix("less than October"))
        let breakdown = CategoryBreakdown(summary)
        #expect(OverviewText.topCategories(breakdown) == "All of it went to Food & drinks.")
        let empty = LedgerReport(ledger: Ledger()).month(MonthKey(today))
        #expect(
            OverviewText.comparison(LedgerReport(ledger: Ledger()).comparison(empty), currency: "CAD")
                == "Nothing spent in either month.")
    }

    @Test("whenPayIsExpected_Home_ShouldNameItApartFromLeftToSpend")
    func expectedIncome() throws {
        let rule = RecurringRule(
            id: "pay", title: "Payday", kind: .income, total: 225_000, share: 225_000, categoryId: "salary",
            date: CalendarDate("2026-11-15") ?? .earliest, frequency: .monthly,
            nextDate: CalendarDate("2026-11-15") ?? .earliest, anchorDay: 15)
        let ledger = Ledger(transactions: [entry("rent", "2026-11-02", 100_000, category: "home")], recurring: [rule])
        let summary = LedgerReport(ledger: ledger).month(MonthKey(today))
        #expect(summary.recordedRemaining == -100_000, "expected pay is not in Left to spend")
        #expect(HomeView.projectedLine(summary, currency: "CAD", pending: 0).hasSuffix("projected with expected pay"))
        let spoken = HomeView.projectedSpoken(summary, currency: "CAD")
        #expect(spoken.contains("expected income not received yet"))
        #expect(RecentSection.recent(summary).map(\.id) == ["rent"], "Recent shows recorded entries only")
        #expect(ExploreSection.calendarLine(CalendarMonth(summary)) == "1 day with entries · 1 expected or scheduled")
    }

    @Test("whenIncomeIsDatedAfterTodayOrAPreviewIsOverdue_ComingUpPanel_ShouldListEverythingProjectedAdds")
    func comingUpListsExpected() throws {
        // A rule whose next date is before today has not been materialized (offline, say): its
        // preview still counts in Projected, so the iPad panel lists it.
        let rent = RecurringRule(
            id: "rent", title: "Rent", kind: .expense, total: 145_000, share: 145_000, categoryId: "home",
            date: CalendarDate("2026-11-01") ?? .earliest, frequency: .monthly,
            nextDate: CalendarDate("2026-11-01") ?? .earliest, anchorDay: 1)
        let ledger = Ledger(
            transactions: [
                entry("invoice", "2026-11-20", 60_000, kind: .income, category: "salary"),
                entry("lunch", "2026-11-03", 1_500),
                entry("bonus", "2026-11-12", 10_000, kind: .income, category: "salary"),
            ], recurring: [rent])
        let summary = LedgerReport(ledger: ledger).month(MonthKey(today), today: today)
        let rows = ComingUpPanel.rows(summary)
        #expect(rows.map(\.id) == ["rent:2026-11-01", "bonus", "invoice"], "soonest first, overdue included")
        let added = rows.reduce(Int64(0)) { $0 + ($1.kind == .income ? $1.share : -$1.share) }
        #expect(summary.recordedRemaining + added == summary.projectedRemaining, "nothing Projected adds is missing")
        #expect(ComingUpPanel.detail(rows[1], today: today).hasSuffix(" · Expected"))
        #expect(ComingUpPanel.detail(rows[0], today: today).hasSuffix(" · Scheduled"))
        #expect(ComingUpPanel.more(rows, currency: "CAD") == nil)
        let many = Ledger(
            transactions: (10...17).map { entry("pay\($0)", "2026-11-\($0)", 100, kind: .income, category: "salary") })
        let crowded = ComingUpPanel.rows(LedgerReport(ledger: many).month(MonthKey(today), today: today))
        #expect(crowded.count == 8)
        #expect(ComingUpPanel.more(crowded, currency: "CAD")?.hasPrefix("2 more · ") == true)
    }

    @Test("whenADayHasExpectedIncome_Calendar_ShouldSayExpectedOrScheduledNotScheduledAlone")
    func calendarWording() throws {
        let ledger = Ledger(transactions: [entry("invoice", "2026-11-20", 60_000, kind: .income, category: "salary")])
        let summary = LedgerReport(ledger: ledger).month(MonthKey(today), today: today)
        let day = try #require(CalendarMonth(summary).day(CalendarDate("2026-11-20") ?? .earliest))
        #expect(day.scheduledCount == 1)
        #expect(day.markers == [.scheduled], "the amber ring, not an income dot")
        let spoken = OverviewText.calendarDay(day, currency: "CAD", today: today)
        #expect(spoken.hasSuffix("1 expected or scheduled, not in Left to spend yet"))
        #expect(!spoken.contains("received"))
        #expect(spoken.hasSuffix(OverviewText.calendarPending(1)), "the day detail shows the same words")
    }

    @Test("whenNothingIsRecorded_Home_ShouldShowTheEmptyHome")
    func emptyHome() {
        let empty = Ledger()
        #expect(HomeView.isEmpty(ledger: empty, report: LedgerReport(ledger: empty)))
        let used = Ledger(transactions: [entry("a", "2026-01-02", 100)])
        #expect(
            !HomeView.isEmpty(ledger: used, report: LedgerReport(ledger: used)), "an empty month is not an empty Home")
        #expect(
            ExploreSection.categoriesLine(
                CategoryBreakdown(LedgerReport(ledger: used).month(MonthKey(today))), currency: "CAD")
                == "No spending yet")
    }
}
