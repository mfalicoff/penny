import Foundation
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

    /// The server's October previews of alex's seeded shared rules, built from the seed's
    /// `sharedRecurring` inputs (not from the expected totals): each occurrence from the rule's
    /// `nextDate` through the month end, id `{rule}:{date}`, alex's equal share among the
    /// members active then (cam left on 2026-10-02). The occurrence dates use the personal
    /// recurrence step, which is the same monthly rule for this seed (recurrence.json).
    static func alexSharedScheduled(_ scenario: SeedFixture.Scenario, through month: MonthKey) throws
        -> [SharedExpenseShare]
    {
        try scenario.steps.flatMap { step -> [SharedExpenseShare] in
            guard step["as"] == .string("alex"), case .object(let recurring) = step["sharedRecurring"],
                case .string(let household) = recurring["household"], case .string(let ref) = recurring["ref"],
                case .object(let body) = recurring["body"], case .string(let title) = body["title"],
                case .number(let totalNumber) = body["totalCents"], body["splitMode"] == .string("equal"),
                case .string(let next) = body["nextDate"], case .string(let frequencyText) = body["frequency"],
                case .object(let category) = body["category"], case .string(let name) = category["name"],
                case .string(let icon) = category["icon"], case .string(let color) = category["color"]
            else { return [] }
            let total = try #require(Int64(exactly: totalNumber))
            let frequency = try #require(RecurrenceFrequency(rawValue: frequencyText))
            var date = try ContractLedger.date(next)
            let anchor = date.day
            var result: [SharedExpenseShare] = []
            while date <= month.last {
                let members: Int64 = date < .day("2026-10-02") ? 3 : 2
                try #require(total % members == 0, "the seed's equal splits divide exactly")
                if date >= month.first {
                    result.append(
                        SharedExpenseShare(
                            id: "\(ref):\(date)", householdId: household, currency: .cad, title: title, date: date,
                            total: total, share: total / members,
                            category: .init(name: name, icon: icon, color: color), recurringId: ref, scheduled: true))
                }
                date = Recurrence.next(after: date, frequency: frequency, anchorDay: anchor)
            }
            return result
        }
    }

    /// A shared Streaming occurrence as both servers send it: a preview has the id
    /// `{rule}:{date}`, `scheduled: true` and `recurringId`; a recorded occurrence has the
    /// expense's random id and, since MAZ-139, the rule as `recurringId`. `recurringId: nil`
    /// is a recorded row from an older server.
    static func streaming(
        _ date: String = "2026-10-20", scheduled: Bool = true, recurringId: String? = "streaming"
    ) -> SharedExpenseShare {
        SharedExpenseShare(
            id: scheduled ? "streaming:\(date)" : "4f1c9a7e2b6d8035e9a1c4f7b2d6e803", householdId: "maison",
            currency: .cad, title: "Streaming", date: .day(date), total: 1600, share: 800,
            category: .init(name: "Fun", icon: "tv-outline", color: "#B15B7D"), recurringId: recurringId,
            scheduled: scheduled)
    }

    /// Parity with v2 `monthBreakdown`: a personal preview is replaced only by the entry with its
    /// occurrence id `{rule}:{date}`. An edited entry keeps `recurringId` but not its occurrence.
    @Test("whenRuleEntryWasMovedOntoAScheduledDate_MonthSummary_ShouldStillCountThatOccurrence")
    func personalPreviewMatchesByIDOnly() throws {
        let month = try #require(Self.october)
        // Created on 2026-10-01 with a random id, then moved to 2026-10-08.
        let weekly = Sample.rule("weekly", start: "2026-10-01", next: "2026-10-08", frequency: .weekly, share: 1000)
        let moved = Sample.entry("random-id", "2026-10-08", share: 1000, recurringId: "weekly")
        let summary = LedgerReport(ledger: Sample.ledger(transactions: [moved], recurring: [weekly])).month(month)
        #expect(summary.recorded.expense == 1000)
        #expect(
            summary.scheduled.map(\.date) == [
                .day("2026-10-08"), .day("2026-10-15"), .day("2026-10-22"), .day("2026-10-29"),
            ])
        #expect(summary.projected.expense == 5000)
    }

    @Test("whenSeededHousehold_MonthSummary_ShouldMatchRedesignRecordedAndProjectedTotals")
    func redesignTotals() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["alex-2026-10"])
        let (scenario, ledger) = try ContractLedger.alexSeed()
        let october = try #require(Self.october)
        // Every input comes from the seed (full-stack-seeds.json); only the assertions use the
        // expected totals.
        let sharedScheduled = try Self.alexSharedScheduled(scenario, through: october)
        #expect(sharedScheduled.map(\.id) == ["streaming:2026-10-20"])
        let report = LedgerReport(
            ledger: ledger, shared: try Self.alexShared(scenario), sharedScheduled: sharedScheduled)
        let month = report.month(october)
        func totals(_ amounts: RedesignStates.Amounts) -> KindTotals {
            KindTotals(expense: amounts.expenseCents, income: amounts.incomeCents, investment: amounts.investmentCents)
        }
        #expect(month.recorded == totals(expected.recorded))
        // Projected adds the scheduled personal and shared expenses (Gym and Streaming).
        #expect(month.projected == totals(expected.projected))
        let scheduled = month.scheduled.map {
            "\($0.source == .personal ? "personal" : "shared") \($0.title) \($0.date) \($0.share)"
        }
        #expect(scheduled == expected.scheduled.map { "\($0.source) \($0.title) \($0.date) \($0.shareCents)" })
        #expect(month.expectedIncome == 0)
        #expect(month.recordedRemaining == -175_950)
        #expect(month.projectedRemaining == -180_750)
        #expect(month.recorded.investment == 50_000, "the ETF purchase is a contribution, not spending")
    }

    /// The local date of an instant in an IANA time zone, as a device in that zone computes it.
    static func localDate(_ instant: String, _ zone: String) throws -> CalendarDate {
        let date = try #require(ISO8601DateFormatter().date(from: instant), "\(instant) is not ISO 8601")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: zone), "\(zone) is not a time zone")
        return CalendarDate(date, in: calendar)
    }

    /// month-totals.json (MAZ-136), generated from v2 `summarizeMonth`: income dated after today
    /// counts toward Projected, not Left to spend, at the boundary and across time zones.
    @Test("whenIncomeIsDatedAfterToday_MonthSummary_ShouldCountItTowardProjectedOnly")
    func monthTotalsFixture() throws {
        let fixture = try Fixtures.decode(MonthTotalsFixture.self, from: "month-totals.json")
        for item in fixture.todayCases {
            #expect(try Self.localDate(item.instant, item.timeZone) == .day(item.today), "\(item)")
        }
        for item in fixture.cases {
            let ledger = try ContractLedger.ledger(try #require(fixture.ledgers[item.ledger]))
            let month = try #require(MonthKey(item.month))
            let today = try item.today.map(ContractLedger.date)
            if let clock = item.clock {
                #expect(try Self.localDate(clock.instant, clock.timeZone) == today, "\(item.name)")
            }
            let summary = LedgerReport(ledger: ledger).month(month, today: today)
            func totals(_ amounts: MonthTotalsFixture.Totals) -> KindTotals {
                KindTotals(expense: amounts.expense, income: amounts.income, investment: amounts.investment)
            }
            #expect(summary.recorded == totals(item.expected.recorded), "\(item.name)")
            #expect(summary.projected == totals(item.expected.projected), "\(item.name)")
            #expect(summary.expectedIncome == item.expected.expectedIncome, "\(item.name)")
            #expect(summary.recordedRemaining == item.expected.recordedNet, "\(item.name)")
            #expect(summary.projectedRemaining == item.expected.projectedNet, "\(item.name)")
            #expect(Set(summary.expected.map(\.id)) == Set(item.expected.expectedIds), "\(item.name)")
            #expect(Set(summary.scheduled.map(\.id)) == Set(item.expected.scheduledIds), "\(item.name)")
            #expect(summary.expected.allSatisfy { $0.isExpected(today: today) && $0.kind == .income })
            #expect(summary.recordedEntries.allSatisfy { !$0.isExpected(today: today) })
            // Home's list keeps the expected entries, unchanged.
            let listed = LedgerReport(ledger: ledger).monthEntries(summary).map(\.id)
            #expect(Set(item.expected.expectedIds).isSubset(of: Set(listed)), "\(item.name)")
        }
    }

    @Test("whenFutureIncomeSeeded_MonthSummary_ShouldMatchRedesignTotalsInThePersonsTimeZone")
    func redesignFutureIncomeTotals() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["dana-2026-10"])
        let seeds = try Fixtures.decode(SeedFixture.self, from: "full-stack-seeds.json")
        let scenario = try #require(seeds.scenarios.first { $0.name == "future-income" })
        let step = try #require(scenario.steps.first { $0["as"] == .string("dana") && $0["ledger"] != nil })
        let wire = try JSONDecoder().decode(
            PennyContracts.Ledger.self, from: try JSONEncoder().encode(try #require(step["ledger"])))
        let ledger = try ContractLedger.ledger(wire)
        let today = try Self.localDate(expected.clock, expected.timeZone)
        #expect(today == .day(expected.today))
        let october = try #require(Self.october)
        let month = LedgerReport(ledger: ledger).month(october, today: today)
        func totals(_ amounts: RedesignStates.Amounts) -> KindTotals {
            KindTotals(expense: amounts.expenseCents, income: amounts.incomeCents, investment: amounts.investmentCents)
        }
        #expect(month.recorded == totals(expected.recorded))
        #expect(month.projected == totals(expected.projected))
        #expect(
            month.expected.map { "\($0.title) \($0.date) \($0.share)" }
                == expected.expected.map {
                    "\($0.title) \($0.date) \($0.shareCents)"
                })
        #expect(
            month.scheduled.map { "\($0.title) \($0.date) \($0.share)" }
                == expected.scheduled.map {
                    "\($0.title) \($0.date) \($0.shareCents)"
                })
        // The same instant in UTC is Oct 16: the invoice dated that day is recorded instead.
        let utc = LedgerReport(ledger: ledger).month(october, today: try Self.localDate(expected.clock, "UTC"))
        #expect(utc.recorded.income == month.recorded.income + 60_000)
        #expect(utc.projected == month.projected)
        // Without a today every dated entry is recorded (the parameter is opt-in).
        #expect(LedgerReport(ledger: ledger).month(october).expected.isEmpty)
    }

    @Test("whenFutureIncomeSeeded_ActivityTotals_ShouldMatchHomesRecordedTotalsAndStillListIt")
    func redesignFutureIncomeActivity() throws {
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        let expected = try #require(states.totals["dana-2026-10"])
        let seeds = try Fixtures.decode(SeedFixture.self, from: "full-stack-seeds.json")
        let scenario = try #require(seeds.scenarios.first { $0.name == "future-income" })
        let step = try #require(scenario.steps.first { $0["as"] == .string("dana") && $0["ledger"] != nil })
        let wire = try JSONDecoder().decode(
            PennyContracts.Ledger.self, from: try JSONEncoder().encode(try #require(step["ledger"])))
        let report = LedgerReport(ledger: try ContractLedger.ledger(wire))
        let today = try Self.localDate(expected.clock, expected.timeZone)
        let october = try #require(Self.october)
        let home = report.month(october, today: today)
        #expect(!home.expected.isEmpty, "the seed has income dated after today")

        let filters = ActivityFilters(period: .month(october))
        let activity = report.activity(filters, index: FoldedSearchIndex(), today: today)
        #expect(activity.summary == home.recorded, "Activity's Came in is Home's recorded income")
        #expect(activity.expectedIncome == home.expected.reduce(0) { $0 + $1.share })
        #expect(report.totals(.month(october), today: today) == home.recorded)
        #expect(report.activity(.month(october), today: today).summary == home.recorded)
        // Expected income is still listed (and marked by the row), only not counted.
        let listed = Set(activity.entries.map(\.id))
        #expect(home.expected.allSatisfy { listed.contains($0.id) })
        // Narrowing never changes the totals.
        var income = filters
        income.kind = .income
        #expect(report.activity(income, index: FoldedSearchIndex(), today: today).summary == home.recorded)
        // Without a today every dated entry counts, as before.
        #expect(report.totals(.month(october)).income == home.recorded.income + activity.expectedIncome)
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
        #expect(before.month(month).scheduled.map(\.share) == [800], "the twice-fetched preview is listed once")
        #expect(before.month(month).projected.expense == 4800, "and projected once")
        // The runner records the occurrence; an older preview response is still cached.
        let after = LedgerReport(
            ledger: ledger, shared: [internet, Self.streaming(scheduled: false)], sharedScheduled: [Self.streaming()])
        #expect(after.month(month).recorded.expense == 4800)
        #expect(after.month(month).scheduled.isEmpty)
        #expect(after.month(month).projected == after.month(month).recorded, "the preview is not counted again")
        // Shared rows in another currency are left out instead of mixing currencies.
        var euro = internet
        euro.currency = .eur
        #expect(LedgerReport(ledger: ledger, shared: [euro]).month(month).recorded == .zero)
        // Shared categories are matched by look and appear once.
        #expect(after.categories.filter { $0.name == "Utilities" }.count == 1)
        #expect(after.month(month).spending.map(\.amount) == [4000, 800])
        // A recorded row from an older server has no `recurringId`: it cannot be matched to the
        // cached preview, so both count until the preview response is refreshed.
        let legacy = LedgerReport(
            ledger: ledger, shared: [Self.streaming(scheduled: false, recurringId: nil)],
            sharedScheduled: [Self.streaming()])
        #expect(legacy.month(month).recorded.expense == 800)
        #expect(legacy.month(month).projected.expense == 1600)
        // Another household's preview of a rule with the same id and date is a different occurrence.
        var other = Self.streaming()
        other.householdId = "cabin"
        let twoHomes = LedgerReport(
            ledger: ledger, shared: [Self.streaming(scheduled: false)], sharedScheduled: [Self.streaming(), other])
        #expect(twoHomes.month(month).projected.expense == 1600)
    }

    /// Legacy `HouseholdProvider` kept the projection in a `Map` and called `unique.set` for
    /// every row: the last copy's values win, at the position the id was first seen.
    @Test("whenASharedRowRepeatsWithNewValues_LedgerReport_ShouldKeepTheLastCopyAtTheFirstPosition")
    func sharedProjectionLastWins() throws {
        let month = try #require(Self.october)
        let category = SharedExpenseShare.Category(name: "Utilities", icon: "flash-outline", color: "#5B7DB1")
        func share(_ id: String, title: String, share: Int64, currency: Currency = .cad) -> SharedExpenseShare {
            SharedExpenseShare(
                id: id, householdId: "maison", currency: currency, title: title, date: .day("2026-10-10"), total: 8000,
                share: share, category: category)
        }
        // An older response, then a newer one after bea edited Internet.
        let report = LedgerReport(
            ledger: Sample.ledger(),
            shared: [
                share("internet", title: "Internet", share: 4000), share("water", title: "Water", share: 1000),
                share("internet", title: "Internet (fibre)", share: 3000),
            ])
        #expect(report.recorded.map(\.id) == ["household:maison:internet", "household:maison:water"])
        #expect(report.recorded.map(\.title) == ["Internet (fibre)", "Water"])
        #expect(report.month(month).recorded.expense == 4000)
        // The last copy decides, also when it is in another currency than the ledger.
        let moved = LedgerReport(
            ledger: Sample.ledger(),
            shared: [
                share("internet", title: "Internet", share: 4000),
                share("internet", title: "I", share: 1, currency: .eur),
            ])
        #expect(moved.recorded.isEmpty)
        // Previews repeat the same way.
        var newer = Self.streaming()
        newer.share = 700
        let previews = LedgerReport(ledger: Sample.ledger(), sharedScheduled: [Self.streaming(), newer])
        #expect(previews.month(month).scheduled.map(\.share) == [700])
    }

    /// Shared amounts come from the wire. A row outside the ledger's stored bounds (total
    /// 1...99,999,999,999, share 0...total, as the server stores them) is refused, so no sum traps.
    @Test("whenASharedRowIsOutOfTheMoneyBounds_LedgerReport_ShouldLeaveItOutInsteadOfOverflowing")
    func sharedMoneyBounds() throws {
        let month = try #require(Self.october)
        func row(_ id: String, total: Int64, share: Int64, scheduled: Bool = false) -> SharedExpenseShare {
            SharedExpenseShare(
                id: id, householdId: "maison", currency: .cad, title: id, date: .day("2026-10-10"), total: total,
                share: share, category: .init(name: "Fun", icon: "i", color: "#B15B7D"), scheduled: scheduled)
        }
        let max = Money.maxCents
        let report = LedgerReport(
            ledger: Sample.ledger(),
            shared: [
                row("huge", total: .max, share: .max), row("huge2", total: .max, share: .max),
                row("over", total: max + 1, share: 1), row("negative", total: 100, share: -1),
                row("exceeds", total: 100, share: 101), row("zero", total: 0, share: 0),
                row("ok", total: max, share: max),
            ],
            sharedScheduled: [row("future", total: .max, share: .max, scheduled: true)])
        let summary = report.month(month)
        #expect(report.recorded.map(\.id) == ["household:maison:ok"])
        #expect(summary.recorded.expense == max && summary.projected.expense == max)
        #expect(summary.scheduled.isEmpty)
        #expect(report.activity(.year(2026)).summary.expense == max)
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

    /// v2 `summarizeMonth` (src/domain/summary.ts, tests/core/domain-rules.test.ts) and
    /// redesign-states.json: projected adds every scheduled occurrence of the month, income,
    /// expenses and investment contributions alike. The legacy app added scheduled income only.
    @Test("whenExpensesAndInvestmentsAreScheduled_MonthSummary_ShouldProjectEveryScheduledOccurrence")
    func projectionCountsEveryScheduledOccurrence() throws {
        let october = try #require(Self.october)
        let rent = Sample.rule("rent", start: "2026-09-01", next: "2026-09-30", anchorDay: 31, share: 100_000)
        let pay = Sample.rule("pay", start: "2026-09-15", next: "2026-10-15", share: 300_000, kind: .income)
        let etf = Sample.rule("etf", start: "2026-09-10", next: "2026-10-10", share: 50000, kind: .investment)
        let ledger = Sample.ledger(
            transactions: [Sample.entry("t", "2026-10-02", share: 1000, total: 2000)], recurring: [rent, pay, etf])
        let summary = LedgerReport(ledger: ledger, sharedScheduled: [Self.streaming()]).month(october)
        #expect(
            summary.scheduled.map(\.id) == [
                "etf:2026-10-10", "pay:2026-10-15", "household:maison:streaming:2026-10-20", "rent:2026-10-31",
            ])
        #expect(summary.recorded == KindTotals(expense: 1000, income: 0, investment: 0))
        #expect(summary.expectedIncome == 300_000)
        #expect(summary.projected == KindTotals(expense: 101_800, income: 300_000, investment: 50000))
        #expect(summary.recordedRemaining == -1000)
        #expect(summary.projectedRemaining == 300_000 - 101_800 - 50000)
        // Part way through the month, the recorded contribution replaces its preview.
        let mid = LedgerReport(
            ledger: Recurrence.materialize(ledger, today: .day("2026-10-12")), sharedScheduled: [Self.streaming()]
        ).month(october)
        #expect(mid.recorded == KindTotals(expense: 1000, income: 0, investment: 50000))
        #expect(mid.projected == summary.projected)
        // Once everything is recorded, projected equals recorded and nothing counts twice.
        let recorded = LedgerReport(
            ledger: Recurrence.materialize(ledger, today: .day("2026-10-31")),
            shared: [Self.streaming(scheduled: false)], sharedScheduled: [Self.streaming()]
        ).month(october)
        #expect(recorded.expectedIncome == 0 && recorded.scheduled.isEmpty)
        #expect(recorded.recorded == KindTotals(expense: 101_800, income: 300_000, investment: 50000))
        #expect(recorded.projected == recorded.recorded)
        #expect(recorded.recordedRemaining == summary.projectedRemaining)
    }

    /// v2 `byDateDescThenId` (src/domain/search.ts): Home, Activity, search and trips share one
    /// order. Trips used to break date ties by id descending.
    @Test("whenDatesTie_HomeActivitySearchAndTrips_ShouldOrderByDateDescendingThenId")
    func oneOrdering() throws {
        let month = try #require(MonthKey("2026-11"))
        let entries = [("b", "2026-11-02"), ("a", "2026-11-01"), ("c", "2026-11-02"), ("a2", "2026-11-02")]
            .map { Sample.entry($0.0, $0.1, title: "Same", tripId: "lisbon") }
        let report = LedgerReport(ledger: Sample.ledger(transactions: entries))
        let expected = ["a2", "b", "c", "a"]
        #expect(report.search("same").map(\.id) == expected)
        #expect(report.monthEntries(report.month(month), query: "same").map(\.id) == expected)
        #expect(report.activity(.month(month), query: "same").entries.map(\.id) == expected)
        #expect(report.trip(Sample.lisbon).expenses.map(\.id) == expected)
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
