import PennyContracts
import PennyDomain
import Testing

@Suite("Reports")
struct ReportTests {
    static let october = MonthKey(year: 2026, month: 10)

    /// alex's shares of the seeded Maison expenses. Equal splits use the members active on the
    /// expense date (cam left on 2026-10-02), as in tests/core/golden-fixtures.test.ts. The seed
    /// only has equal splits that divide exactly, so no remainder rule is needed here (shared
    /// remainder allocation is server-owned and MAZ-75's to port).
    static func alexShared(_ scenario: SeedFixture.Scenario) throws -> [SharedExpenseShare] {
        try scenario.steps.compactMap { step -> SharedExpenseShare? in
            guard case .object(let expense) = step["expense"], case .object(let body) = expense["body"],
                case .string(let ref) = expense["ref"], case .string(let title) = body["title"],
                case .string(let dateText) = body["date"], case .number(let totalNumber) = body["totalCents"],
                case .string(let mode) = body["splitMode"], case .object(let category) = body["category"],
                case .string(let name) = category["name"], case .string(let icon) = category["icon"],
                case .string(let color) = category["color"]
            else { return nil }
            let date = try ContractLedger.date(dateText)
            let total = try #require(Int64(exactly: totalNumber))
            let share: Int64
            if mode == "equal" {
                let members: Int64 = dateText < "2026-10-02" ? 3 : 2
                try #require(total % members == 0, "the seed's equal splits divide exactly")
                share = total / members
            } else {
                guard case .array(let allocations) = body["allocations"] else { return nil }
                share = allocations.compactMap { allocation -> Int64? in
                    guard case .object(let item) = allocation, item["userId"] == .string("$user:alex"),
                        case .number(let amount) = item["amountCents"]
                    else { return nil }
                    return Int64(exactly: amount)
                }.reduce(0, +)
            }
            return SharedExpenseShare(
                id: ref, householdId: "maison", currency: .cad, title: title, date: date, total: total, share: share,
                category: .init(name: name, icon: icon, color: color))
        }
    }

    static func streaming(_ date: String = "2026-10-20", scheduled: Bool = true) -> SharedExpenseShare {
        SharedExpenseShare(
            id: scheduled ? "streaming:\(date)" : "occ-\(date)", householdId: "maison", currency: .cad,
            title: "Streaming", date: .day(date), total: 1600, share: 800,
            category: .init(name: "Fun", icon: "tv-outline", color: "#B15B7D"), recurringId: "streaming",
            scheduled: scheduled)
    }

    @Test("whenSeededHousehold_MonthSummary_ShouldMatchRedesignRecordedAndProjectedTotals")
    func redesignTotals() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["alex-2026-10"])
        let (scenario, ledger) = try ContractLedger.alexSeed()
        let sharedScheduled = expected.scheduled.filter { $0.source == "shared" }.map { item in
            SharedExpenseShare(
                id: "streaming:\(item.date)", householdId: "maison", currency: .cad, title: item.title,
                date: .day(item.date), total: item.shareCents * 2, share: item.shareCents,
                category: .init(name: "Fun", icon: "tv-outline", color: "#B15B7D"), recurringId: "streaming",
                scheduled: true)
        }
        let report = LedgerReport(
            ledger: ledger, shared: try Self.alexShared(scenario), sharedScheduled: sharedScheduled)
        let month = report.month(try #require(Self.october))
        func totals(_ amounts: RedesignStates.Amounts) -> KindTotals {
            KindTotals(expense: amounts.expenseCents, income: amounts.incomeCents, investment: amounts.investmentCents)
        }
        #expect(month.recorded == totals(expected.recorded))
        #expect(month.projected == totals(expected.projected))
        let scheduled = month.scheduled.map {
            "\($0.source == .personal ? "personal" : "shared") \($0.title) \($0.date) \($0.share)"
        }
        #expect(scheduled == expected.scheduled.map { "\($0.source) \($0.title) \($0.date) \($0.shareCents)" })
        #expect(month.expectedIncome == 0)
        #expect(month.recordedRemaining == -175_950 && month.projectedRemaining == -180_750)
        #expect(month.recorded.investment == 50_000, "the ETF purchase is a contribution, not spending")
    }

    @Test("whenSharedRowsRepeatOrAreRecorded_LedgerReport_ShouldCountEachOccurrenceOnce")
    func sharedProjectionDeduplication() throws {
        let month = try #require(Self.october)
        let ledger = Sample.ledger()
        let internet = SharedExpenseShare(
            id: "internet", householdId: "maison", currency: .cad, title: "Internet", date: .day("2026-10-10"),
            total: 8000, share: 4000, category: .init(name: "Utilities", icon: "flash-outline", color: "#5B7DB1"))
        // Month and year responses both hold the same expense; the preview was fetched twice.
        let before = LedgerReport(
            ledger: ledger, shared: [internet, internet], sharedScheduled: [Self.streaming(), Self.streaming()])
        #expect(before.month(month).recorded.expense == 4000)
        #expect(before.month(month).projected.expense == 4800)
        // The runner records the occurrence; an older preview response is still cached.
        let after = LedgerReport(
            ledger: ledger, shared: [internet, Self.streaming(scheduled: false)], sharedScheduled: [Self.streaming()])
        #expect(after.month(month).recorded.expense == 4800)
        #expect(after.month(month).projected.expense == 4800)
        #expect(after.month(month).scheduled.isEmpty)
        // Shared rows in another currency are left out instead of mixing currencies.
        var euro = internet
        euro.currency = .eur
        #expect(LedgerReport(ledger: ledger, shared: [euro]).month(month).recorded == .zero)
        // Shared categories are matched by look and appear once.
        #expect(after.categories.filter { $0.name == "Utilities" }.count == 1)
        #expect(after.month(month).spending.map(\.amount) == [4000, 800])
    }

    @Test("whenIncomeIsScheduled_MonthSummary_ShouldShowItAsExpectedAndOnlyInProjected")
    func expectedIncome() throws {
        let month = try #require(MonthKey("2026-11"))
        let pay = Sample.rule("pay", start: "2026-10-15", next: "2026-11-15", share: 225_000, kind: .income)
        let rent = Sample.entry("rent", "2026-11-01", share: 120_000)
        let ledger = Sample.ledger(transactions: [rent], recurring: [pay])
        let before = LedgerReport(ledger: ledger).month(month)
        #expect(before.expectedIncome == 225_000)
        #expect(before.recorded.income == 0 && before.recordedRemaining == -120_000)
        #expect(before.projected.income == 225_000 && before.projectedRemaining == 105_000)
        // Once materialized, the recorded occurrence replaces the preview: income is not doubled.
        let after = LedgerReport(ledger: Recurrence.materialize(ledger, today: .day("2026-11-15"))).month(month)
        #expect(after.expectedIncome == 0)
        #expect(after.recorded.income == 225_000 && after.projected.income == 225_000)
        #expect(after.projectedRemaining == before.projectedRemaining)
        // Paused or removed schedules contribute nothing.
        var paused = ledger
        paused.recurring[0].active = false
        #expect(LedgerReport(ledger: paused).month(month).projected == before.recorded)
    }

    @Test("whenEntriesAreSplit_Reports_ShouldCountPersonalSharesNotReceiptTotals")
    func personalShareTotals() throws {
        let month = try #require(MonthKey("2026-11"))
        let ledger = Sample.ledger(transactions: [
            Sample.entry("dinner", "2026-11-03", share: 3334, total: 10001, tripId: "lisbon"),
            Sample.entry("hotel", "2026-11-04", share: 0, total: 50000, category: "home", tripId: "lisbon"),
            Sample.entry("etf", "2026-11-05", share: 50000, kind: .investment),
            Sample.entry("pay", "2026-11-06", share: 100_000, kind: .income),
        ])
        let report = LedgerReport(ledger: ledger)
        let summary = report.month(month)
        #expect(summary.recorded == KindTotals(expense: 3334, income: 100_000, investment: 50000))
        #expect(summary.recordedRemaining == 46_666)
        // A zero share is recorded but never shown as spending.
        #expect(summary.spending.map(\.category.id) == ["food"])
        let trip = report.trip(Sample.lisbon)
        #expect(trip.total == 3334 && trip.receiptTotal == 60001)
        #expect(trip.expenses.map(\.id) == ["hotel", "dinner"])
        #expect(report.tripTotals["lisbon"]?.total == 3334 && report.tripTotals["lisbon"]?.count == 2)
    }

    @Test("whenPeriodHasPreviewsAndSharedRows_Activity_ShouldListRecordedEntriesOnly")
    func recordedOnlyActivity() throws {
        let month = try #require(MonthKey("2026-11"))
        let ledger = Sample.ledger(
            transactions: [
                Sample.entry("b", "2026-11-02"), Sample.entry("a", "2026-11-02"), Sample.entry("z", "2026-11-09"),
            ],
            recurring: [Sample.rule("gym", start: "2026-11-30")])
        let internet = SharedExpenseShare(
            id: "internet", householdId: "maison", currency: .cad, title: "Internet", date: .day("2026-11-10"),
            total: 8000, share: 4000, category: .init(name: "Utilities", icon: "i", color: "#5B7DB1"))
        let report = LedgerReport(ledger: ledger, shared: [internet], sharedScheduled: [Self.streaming("2026-11-20")])
        let page = report.activity(.month(month))
        #expect(page.entries.map(\.id) == ["household:maison:internet", "z", "a", "b"])
        #expect(page.summary.expense == 7000)
        #expect(page.days.map(\.date) == [.day("2026-11-10"), .day("2026-11-09"), .day("2026-11-02")])
        // Kind and query never change the period totals.
        #expect(report.activity(.month(month), query: "zzz", kind: .income).summary == page.summary)
        #expect(report.activity(.year(2026)).totalCount == 4)
        #expect(report.activity(.year(2025)).entries.isEmpty)
        // Home lists the previews beside recorded entries, without counting them as recorded.
        let home = report.month(month)
        #expect(
            report.monthEntries(home).map(\.id).prefix(2) == [
                "gym:2026-11-30", "household:maison:streaming:2026-11-20",
            ])
        #expect(report.monthEntries(home, kind: .expense, day: .day("2026-11-02")).map(\.id) == ["a", "b"])
        #expect(report.monthEntries(home, categoryId: "food").count == 4)
    }

    @Test("whenMoreThanOnePage_Activity_ShouldPageDeterministicallyAndClamp")
    func paging() throws {
        let month = try #require(MonthKey("2026-11"))
        let entries = (0..<120).map {
            Sample.entry("e" + String($0).leftPadded(3), "2026-11-\(String(1 + $0 % 28).leftPadded(2))")
        }
        let report = LedgerReport(ledger: Sample.ledger(transactions: entries.reversed()))
        let pages = (0..<3).map { report.activity(.month(month), page: $0) }
        #expect(pages.map(\.entries.count) == [50, 50, 20])
        #expect(pages.allSatisfy { $0.pageCount == 3 && $0.totalCount == 120 })
        let ids = pages.flatMap(\.entries).map(\.id)
        #expect(Set(ids).count == 120)
        let sorted = pages.flatMap(\.entries)
        #expect(
            zip(sorted, sorted.dropFirst()).allSatisfy { $0.date > $1.date || ($0.date == $1.date && $0.id < $1.id) })
        #expect(report.activity(.month(month), page: 99).page == 2)
        #expect(report.activity(.month(month), page: -3).page == 0)
        #expect(LedgerReport(ledger: Sample.ledger()).activity(.month(month), page: 4).pageCount == 1)
    }

    @Test("whenMonthKeysAreShiftedOrParsed_MonthKey_ShouldStayInTheLedgerRange")
    func monthKeys() throws {
        let february = try #require(MonthKey("2024-02"))
        #expect(february.last == .day("2024-02-29"))
        #expect(MonthKey("2100-12")?.shifted(by: 1) == nil)
        #expect(MonthKey("2000-01")?.shifted(by: -1) == nil)
        #expect(february.shifted(by: 11)?.description == "2025-01")
        #expect(february.shifted(by: -14)?.description == "2022-12")
        for text in ["2024-2", "2024-13", "1999-12", "2024-02-01", "２０２４-02"] { #expect(MonthKey(text) == nil) }
    }
}
