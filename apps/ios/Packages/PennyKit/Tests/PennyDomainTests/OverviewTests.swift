import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Overview: money flow, calendar and categories")
struct OverviewTests {
    static let november = MonthKey(year: 2026, month: 11)

    static func month(_ ledger: PennyDomain.Ledger, shared: [SharedExpenseShare] = []) throws -> (
        LedgerReport, MonthSummary
    ) {
        let report = LedgerReport(ledger: ledger, shared: shared)
        return (report, report.month(try #require(november)))
    }

    /// Both columns of a flow hold every cent: sources and destinations each add up to `total`.
    static func expectBalanced(_ flow: MoneyFlow, sourceLocation: SourceLocation = #_sourceLocation) {
        let sources = flow.sources.reduce(Int64(0)) { $0 + $1.amount }
        let destinations = flow.destinations.reduce(Int64(0)) { $0 + $1.amount }
        #expect(sources == flow.total, sourceLocation: sourceLocation)
        #expect(destinations == flow.total, sourceLocation: sourceLocation)
    }

    @Test("whenSeededHousehold_Overview_ShouldMatchRedesignRecordedTotalsAndScheduledDays")
    func redesignFixture() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["alex-2026-10"])
        let (scenario, ledger) = try ContractLedger.alexSeed()
        let october = try #require(ReportTests.october)
        let report = LedgerReport(
            ledger: ledger, shared: try ReportTests.alexShared(scenario),
            sharedScheduled: try ReportTests.alexSharedScheduled(scenario, through: october))
        let summary = report.month(october)

        // The money flow is recorded only and uses shares: the same numbers as the fixture.
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.income == expected.recorded.incomeCents)
        #expect(flow.expense == expected.recorded.expenseCents)
        #expect(flow.investment == expected.recorded.investmentCents)
        #expect(flow.gap == max(0, -summary.recordedRemaining))
        #expect(flow.remaining == max(0, summary.recordedRemaining))
        #expect(flow.destinations.contains { $0.role == .invested && $0.amount == expected.recorded.investmentCents })
        Self.expectBalanced(flow)

        // The calendar adds up to the same recorded totals, and its scheduled rings are exactly
        // the fixture's scheduled occurrences.
        let calendar = CalendarMonth(summary)
        #expect(calendar.days.reduce(0) { $0 + $1.spent } == expected.recorded.expenseCents)
        #expect(calendar.days.reduce(0) { $0 + $1.income } == expected.recorded.incomeCents)
        #expect(calendar.days.reduce(0) { $0 + $1.invested } == expected.recorded.investmentCents)
        let scheduledDays = calendar.days.flatMap { day in Array(repeating: day.date, count: day.scheduledCount) }
        #expect(scheduledDays.map(\.description) == expected.scheduled.map(\.date).sorted())
        let scheduledNet = calendar.days.reduce(Int64(0)) { $0 + $1.scheduledNet }
        #expect(scheduledNet == summary.projectedRemaining - summary.recordedRemaining)

        // Insights: spending only, at your share.
        let breakdown = CategoryBreakdown(summary)
        #expect(breakdown.total == expected.recorded.expenseCents)
        #expect(breakdown.rows.reduce(0) { $0 + $1.amount } == expected.recorded.expenseCents)
        #expect(!breakdown.rows.contains { $0.category.kind != .expense })
    }

    @Test("whenSharedRowsRepeatAcrossResponses_Overview_ShouldCountTheViewersShareOnce")
    func sharedOnce() throws {
        let share = SharedExpenseShare(
            id: "e1", householdId: "maison", currency: .cad, title: "Groceries", date: .day("2026-11-03"),
            total: 9000, share: 3000, category: .init(name: "Groceries", icon: "basket-outline", color: "#0FA3A3"))
        let preview = SharedExpenseShare(
            id: "rent:2026-11-20", householdId: "maison", currency: .cad, title: "Rent", date: .day("2026-11-20"),
            total: 200_000, share: 100_000, category: .init(name: "Home", icon: "home-outline", color: "#3B82F6"),
            recurringId: "rent", scheduled: true)
        let personal = Sample.entry("p1", "2026-11-02", share: 2500, total: 5000)
        // The same shared row in two period responses, and a preview: counted once, as a share.
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [personal]), shared: [share, share, preview])
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.expense == 5500, "your shares: 2,500 personal + 3,000 shared, never the 14,000 totals")
        let calendar = CalendarMonth(summary)
        #expect(calendar.day(.day("2026-11-03"))?.spent == 3000)
        #expect(calendar.day(.day("2026-11-20"))?.scheduledCount == 1)
        #expect(calendar.day(.day("2026-11-20"))?.spent == 0, "a preview is never spending")
        #expect(CategoryBreakdown(summary).total == 5500)
    }

    @Test("whenTheMonthIsEmpty_Overview_ShouldHaveNoFlowNoMarkersAndNoCategories")
    func emptyMonth() throws {
        let (report, summary) = try Self.month(Sample.ledger())
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.isEmpty)
        #expect(flow.nodes.isEmpty)
        #expect(flow.total == 0)
        let calendar = CalendarMonth(summary)
        #expect(calendar.days.count == 30)
        #expect(calendar.activeDays.isEmpty)
        #expect(calendar.days.allSatisfy { $0.markers.isEmpty })
        #expect(CategoryBreakdown(summary).isEmpty)
        #expect(calendar.averageDailySpending(today: .day("2026-11-10")) == 0)
        #expect(calendar.averageDailySpending(today: .day("2026-10-10")) == nil, "the month hasn't started")
        // An empty flow still lays out without dividing by zero.
        let layout = MoneyFlowLayout(flow, band: 200, slot: 40, gap: 8)
        #expect(layout.sources.isEmpty && layout.destinations.isEmpty)
        #expect(layout.height == 200)
    }

    @Test("whenMoreWentOutThanCameIn_MoneyFlow_ShouldShowTheGapAsBeyondIncomeAndNothingLeftOver")
    func overspent() throws {
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [
                Sample.entry("pay", "2026-11-01", share: 100_000, kind: .income),
                Sample.entry("rent", "2026-11-02", share: 120_000, category: "home"),
                Sample.entry("etf", "2026-11-03", share: 20_000, kind: .investment),
            ]))
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.gap == 40_000)
        #expect(flow.remaining == 0)
        #expect(flow.sources.last?.role == .beyondIncome)
        #expect(flow.sources.last?.label == "Beyond income")
        #expect(!flow.destinations.contains { $0.role == .leftOver })
        #expect(summary.recordedRemaining == -40_000)
        Self.expectBalanced(flow)
        let rent = try #require(flow.node(id: "expense:home"))
        #expect(flow.percentOfIncome(rent) == "120%")
        #expect(flow.percentOfSpending(rent) == "100%")
    }

    @Test("whenOnlyIncomeIsRecorded_Overview_ShouldLeaveItAllOverWithNoSpending")
    func incomeOnly() throws {
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [Sample.entry("pay", "2026-11-01", share: 320_000, kind: .income)]))
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.sources.map(\.id) == ["income:salary"])
        #expect(flow.destinations.map(\.id) == ["balance:remaining"])
        #expect(flow.remaining == 320_000)
        Self.expectBalanced(flow)
        #expect(CategoryBreakdown(summary).isEmpty)
        let day = try #require(CalendarMonth(summary).day(.day("2026-11-01")))
        #expect(day.markers == [.income])
        #expect(day.recordedNet == 320_000)
    }

    @Test("whenThereAreManyCategories_MoneyFlow_ShouldKeepFourAndFoldTheRestIntoNMore")
    func foldsSmallCategories() throws {
        let ids = ["home", "groceries", "transport", "food", "shopping", "fun", "health", "other"]
        let entries = ids.enumerated().map { index, id in
            Sample.entry(
                "e\(index)", "2026-11-0\(index % 9 + 1)", share: Int64((ids.count - index) * 1000), category: id)
        }
        let (report, summary) = try Self.month(Sample.ledger(transactions: entries))
        let flow = MoneyFlow(summary, categories: report.categories)
        let expenses = flow.destinations.filter {
            if case .expense = $0.role { return true }
            if case .more = $0.role { return true }
            return false
        }
        #expect(expenses.count == MoneyFlow.maxRows)
        #expect(
            expenses.prefix(4).map(\.id) == ["expense:home", "expense:groceries", "expense:transport", "expense:food"])
        let more = try #require(expenses.last)
        #expect(more.label == "4 more")
        #expect(more.categoryIds == ["shopping", "fun", "health", "other"])
        #expect(more.amount == 4000 + 3000 + 2000 + 1000)
        #expect(flow.expense == summary.recorded.expense, "folding keeps every cent")
        Self.expectBalanced(flow)
    }

    @Test("whenIncomeIsScheduled_Overview_ShouldShowItAsScheduledNeverAsRecordedIncome")
    func scheduledIncomeIsNotRecorded() throws {
        let payday = Sample.rule("pay", start: "2026-11-15", share: 225_000, kind: .income)
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [Sample.entry("coffee", "2026-11-02", share: 500)], recurring: [payday]))
        let flow = MoneyFlow(summary, categories: report.categories)
        #expect(flow.income == 0, "expected pay is not money that came in")
        #expect(flow.gap == 500)
        let day = try #require(CalendarMonth(summary).day(.day("2026-11-15")))
        #expect(day.income == 0 && day.recordedCount == 0)
        #expect(day.scheduledCount == 1 && day.scheduledNet == 225_000)
        #expect(day.markers == [.scheduled])
        #expect(CategoryBreakdown(summary).total == 500)
        // A preview passed straight to the flow is ignored too.
        let mixed = MoneyFlow(entries: summary.recordedEntries + summary.scheduled, categories: report.categories)
        #expect(mixed == flow)
    }

    @Test("whenMoneyIsInvested_Overview_ShouldTreatItAsAContributionNotSpending")
    func investments() throws {
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [
                Sample.entry("pay", "2026-11-01", share: 300_000, kind: .income),
                Sample.entry("tfsa", "2026-11-06", share: 20_000, kind: .investment),
                Sample.entry("bus", "2026-11-06", share: 6_200, category: "transport"),
            ]))
        let flow = MoneyFlow(summary, categories: report.categories)
        let invested = try #require(flow.node(id: "investment:total"))
        #expect(invested.role == .invested)
        #expect(flow.percentOfSpending(invested) == nil)
        #expect(flow.percentOfIncome(invested) == "7%")
        #expect(flow.expense == 6_200)
        #expect(CategoryBreakdown(summary).total == 6_200, "contributions are not spending")
        let day = try #require(CalendarMonth(summary).day(.day("2026-11-06")))
        #expect(day.markers == [.spent, .invested])
        #expect(day.recordedNet == -26_200)
    }

    @Test("whenCategoryLabelsAreLong_MoneyFlow_ShouldKeepTheWholeName")
    func longLabels() throws {
        let name = String(repeating: "Very long category name ", count: 8)
        var ledger = Sample.ledger(transactions: [Sample.entry("e", "2026-11-02", share: 100, category: "long")])
        ledger.categories.append(
            LedgerCategory(id: "long", name: name, icon: "pricetag", color: "#3B82F6", kind: .expense))
        let (report, summary) = try Self.month(ledger)
        #expect(MoneyFlow(summary, categories: report.categories).destinations.first?.label == name)
        #expect(CategoryBreakdown(summary).rows.first?.category.name == name)
    }

    @Test("whenLaidOut_MoneyFlowLayout_ShouldGiveEveryRowItsOwnSlotAndFillTheBand")
    func layout() throws {
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [
                Sample.entry("pay", "2026-11-01", share: 280_000, kind: .income),
                Sample.entry("free", "2026-11-01", share: 40_000, kind: .income, category: "freelance"),
                Sample.entry("rent", "2026-11-02", share: 145_000, category: "home"),
                Sample.entry("tiny", "2026-11-02", share: 1, category: "food"),
            ]))
        let flow = MoneyFlow(summary, categories: report.categories)
        let layout = MoneyFlowLayout(flow, band: 200, slot: 40, gap: 8)
        for column in [layout.sources, layout.destinations] {
            #expect(abs(column.reduce(0) { $0 + $1.thickness } - 200) < 0.0001, "bands fill the middle bar")
            for (upper, lower) in zip(column, column.dropFirst()) {
                #expect(upper.slotTop + upper.slotHeight <= lower.slotTop, "slots never overlap")
            }
            #expect(column.allSatisfy { $0.slotHeight >= 40 })
            #expect(column.allSatisfy { $0.slotTop >= 0 && $0.slotTop + $0.slotHeight <= layout.height + 0.0001 })
        }
        let rent = try #require(layout.destinations.first)
        #expect(layout.row(at: rent.labelY, source: false)?.id == "expense:home")
        #expect(layout.row(at: -1, source: false) == nil)
    }

    @Test("whenTheMonthStartsOnASunday_CalendarMonth_ShouldStartOnTheSeventhColumn")
    func grid() throws {
        let (_, summary) = try Self.month(Sample.ledger())
        let calendar = CalendarMonth(summary)
        #expect(calendar.leadingBlanks == 6, "1 November 2026 is a Sunday")
        #expect(calendar.weeks.count == 6)
        #expect(calendar.weeks.allSatisfy { $0.count == 7 })
        #expect(calendar.weeks.flatMap { $0 }.compactMap { $0 }.count == 30)
        #expect(calendar.weeks[0][6]?.date == .day("2026-11-01"))
    }

    @Test("whenComparingMonths_Overview_ShouldUseRecordedSpendingOfBoth")
    func comparison() throws {
        let (report, summary) = try Self.month(
            Sample.ledger(transactions: [
                Sample.entry("oct", "2026-10-10", share: 230_000),
                Sample.entry("nov", "2026-11-10", share: 188_335),
                Sample.entry("pay", "2026-11-01", share: 500_000, kind: .income),
            ]))
        let comparison = report.comparison(summary)
        #expect(comparison.current == 188_335)
        #expect(comparison.previous == 230_000)
        #expect(comparison.difference == -41_665)
        #expect(comparison.previousMonth == MonthKey(year: 2026, month: 10))
        let filtered = report.categoryEntries(summary, categoryIds: ["food"])
        #expect(filtered.map(\.id) == ["nov"])
        #expect(report.month(summary.month) == summary, "filtering the list never changes the month")
    }

    @Test("whenRounding_Percent_ShouldRoundHalfUpAndMarkTinyShares")
    func percent() {
        #expect(Percent.text(1, of: 3) == "33%")
        #expect(Percent.text(1, of: 2) == "50%")
        #expect(Percent.text(1, of: 200) == "1%")
        #expect(Percent.text(1, of: 1000) == "<1%")
        #expect(Percent.text(0, of: 1000) == "0%")
        #expect(Percent.text(5, of: 0) == nil)
        #expect(Percent.rounded(99_999_999_999 * 100_000, of: 99_999_999_999 * 100_000) == 100)
    }

    /// Performance budget for the largest ledger the rules allow (`Ledger.maxEntries`):
    /// joining it, summarizing a month and building every overview must stay well under a
    /// frame budget per change on the Mac host, and give exact totals. The bound is generous
    /// so a busy CI machine doesn't flake; docs/ios-overview.md records measured times.
    @Test("whenTheLedgerHasAHundredThousandEntries_Overview_ShouldStayFastAndExact")
    func largeLedger() throws {
        let month = try #require(Self.november)
        let kinds: [EntryKind] = [.expense, .expense, .expense, .income, .investment]
        let categories: [EntryKind: [String]] = [
            .expense: ["home", "groceries", "transport", "food", "shopping", "fun", "health", "other"],
            .income: ["salary", "freelance", "gift"], .investment: ["investments"],
        ]
        var entries: [LedgerEntry] = []
        entries.reserveCapacity(PennyDomain.Ledger.maxEntries)
        let start = CalendarDate.day("2026-01-01")
        for index in 0..<PennyDomain.Ledger.maxEntries {
            let kind = kinds[index % kinds.count]
            let ids = categories[kind] ?? []
            entries.append(
                LedgerEntry(
                    id: "e\(index)", title: "Entry \(index)", kind: kind, total: Int64(index % 5000 + 1),
                    share: Int64(index % 5000 + 1), categoryId: ids[index % ids.count],
                    date: start.adding(days: index % 334)))
        }
        let ledger = Sample.ledger(transactions: entries)
        let clock = ContinuousClock()
        var flow: MoneyFlow?
        var summary: MonthSummary?
        let elapsed = clock.measure {
            let report = LedgerReport(ledger: ledger)
            let november = report.month(month)
            flow = MoneyFlow(november, categories: report.categories)
            _ = CalendarMonth(november)
            _ = CategoryBreakdown(november)
            _ = report.comparison(november)
            summary = november
        }
        let result = try #require(summary)
        let expected = KindTotals(
            entries.filter { month.contains($0.date) }.map {
                ReportEntry.recorded($0)
            })
        #expect(result.recorded == expected)
        #expect(flow?.expense == expected.expense)
        #expect(elapsed < .seconds(10), "took \(elapsed)")
    }
}
