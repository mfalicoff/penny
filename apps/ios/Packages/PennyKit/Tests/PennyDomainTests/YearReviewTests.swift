import Foundation
import PennyContracts
import PennyDomain
import Testing

/// The year in review (MAZ-292, phase 2) against contracts/fixtures/year-review.json, generated from
/// the web's `yearReview` (apps/web/src/domain/yearReview.ts), and the rules around it.
@Suite("Year in review")
struct YearReviewTests {
    typealias Fixture = YearReviewFixture

    /// A projection row as the app reads it (`SharedExpenseShare(wire:currency:)`): who paid is
    /// resolved to a shown name, and the payer's email is kept (never shown) when someone else paid.
    static func share(_ row: MonthReviewFixture.ProjectedExpense) throws -> SharedExpenseShare {
        var share = try MonthReviewTests.share(row)
        share.payerEmail = row.paidByYou == true ? nil : row.payer?.email
        return share
    }

    static func report(_ fixture: Fixture, _ item: Fixture.Case) throws -> LedgerReport {
        let ledger = try ContractLedger.ledger(try #require(fixture.ledgers[item.ledger]))
        let rows = try #require(fixture.projections[item.projection]).map(share)
        return LedgerReport(ledger: ledger, shared: rows)
    }

    static func households(_ fixture: Fixture) throws -> [YearReview.Household] {
        try fixture.households.map { household in
            YearReview.Household(
                id: household.id, memberCount: household.memberCount,
                trip: try household.trip.map {
                    TripRange(start: try ContractLedger.date($0.startDate), end: try ContractLedger.date($0.endDate))
                })
        }
    }

    /// The Swift result in the fixture's shape (as JSON, decoded into the fixture's model), so the
    /// whole result is compared at once. A payer's wire object (email, display name, deleted) is the
    /// one the projection sent for that key, after checking that the Swift row shows the name the
    /// app shows for it.
    static func wire(_ review: YearReview, rows: [MonthReviewFixture.ProjectedExpense]) throws -> Fixture.Review {
        let date = { (date: CalendarDate) in date.description }
        func payer(_ row: YearReview.Payer) throws -> Any? {
            guard !row.isYou else { return nil }
            let wire = rows.compactMap(\.payer).first { $0.email.lowercased() == row.key }
            // The shown name: "Former member" for a deleted account, never the email.
            if case .member(let name) = MonthReviewTests.payer(paidByYou: false, wire) {
                #expect(row.name == name, "\(row.key)")
            } else {
                Issue.record("\(row.key) has no payer in the projection")
            }
            return try wire.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) }
        }
        let month = { (month: YearReview.Month) -> [String: Any] in
            ["month": month.month.description, "spent": month.spent]
        }
        var object: [String: Any] = [
            "year": String(review.year), "empty": review.isEmpty, "to": date(review.to), "spent": review.spent,
            "months": review.months.map(month), "monthlyAverage": review.monthlyAverage,
            "topCategories": review.topCategories.map {
                [
                    "key": $0.key, "name": $0.name, "icon": $0.icon, "color": $0.color, "amount": $0.amount,
                    "share": $0.share,
                ]
                    as [String: Any]
            },
        ]
        object["from"] = review.from.map(date)
        object["busiestMonth"] = review.busiestMonth.map(month)
        var trips: [String: Any] = [
            "list": review.trips.list.map {
                [
                    "id": $0.id, "kind": $0.kind.rawValue, "startDate": date($0.startDate), "endDate": date($0.endDate),
                    "days": $0.days, "share": $0.share, "sharedWith": $0.sharedWith,
                ] as [String: Any]
            },
            "daysAway": review.trips.daysAway, "share": review.trips.share,
        ]
        trips["longestId"] = review.trips.longestId
        trips["costliestId"] = review.trips.costliestId
        object["trips"] = trips
        object["shared"] =
            [
                "count": review.shared.count, "paidByYouPercent": review.shared.paidByYouPercent,
                "payers": try review.shared.payers.map { row -> [String: Any] in
                    var item: [String: Any] = [
                        "key": row.key, "you": row.isYou, "count": row.count, "householdIds": row.householdIds,
                    ]
                    item["payer"] = try payer(row)
                    return item
                },
                "householdIds": review.shared.householdIds, "othersPaid": review.shared.othersPaid,
            ] as [String: Any]
        var facts: [String: Any] = [
            "daysWithoutSpending": review.facts.daysWithoutSpending,
            "expensesRecorded": review.facts.expensesRecorded, "perWeek": review.facts.perWeek,
        ]
        facts["longestRun"] = review.facts.longestRun.map {
            ["start": date($0.start), "end": date($0.end), "days": $0.days] as [String: Any]
        }
        facts["busiestWeekday"] = review.facts.busiestWeekday
        facts["mostFrequentCategory"] = review.facts.mostFrequentCategory.map {
            ["key": $0.key, "name": $0.name, "icon": $0.icon, "color": $0.color, "count": $0.count] as [String: Any]
        }
        object["facts"] = facts
        return try JSONDecoder().decode(Fixture.Review.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test("whenFixtureCasesAreReviewed_YearReview_ShouldMatchTheWebRule")
    func fixture() throws {
        let fixture = try Fixtures.decode(Fixture.self, from: "year-review.json")
        #expect(fixture.cases.count >= 6)
        let households = try Self.households(fixture)
        for item in fixture.cases {
            let review = try Self.report(fixture, item)
                .yearReview(
                    try #require(Int(item.year)), today: try ContractLedger.date(item.today), households: households)
            let rows = try #require(fixture.projections[item.projection])
            #expect(try Self.wire(review, rows: rows) == item.expected, "\(item.name)")
        }
    }

    @Test("whenTheDayIsInOrOutOfTheWindow_YearReview_ShouldOfferTheYearAndTheJanuaryBanner")
    func window() throws {
        let fixture = try Fixtures.decode(Fixture.self, from: "year-review.json")
        #expect(fixture.window.count >= 5)
        for item in fixture.window {
            let today = try ContractLedger.date(item.today)
            #expect(YearReview.offeredYear(today: today).map(String.init) == item.year, "\(item.today)")
            #expect(YearReview.bannerYear(today: today).map(String.init) == item.banner, "\(item.today)")
        }
    }

    private static func entry(
        _ id: String, _ cents: Int64, _ date: String, category: String = "food", kind: EntryKind = .expense,
        trip: String? = nil
    ) throws -> LedgerEntry {
        LedgerEntry(
            id: id, title: "Secret \(id)", kind: kind, total: cents, share: cents, categoryId: category,
            accountId: "chq", tripId: trip, date: try ContractLedger.date(date), note: "a private note")
    }

    private static func ledger(_ entries: [LedgerEntry], trips: [PennyDomain.Trip] = []) -> PennyDomain.Ledger {
        var ledger = PennyDomain.Ledger()
        ledger.accounts = [PaymentAccount(id: "chq", name: "Chequing", type: .bank)]
        ledger.categories = [
            LedgerCategory(id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: .expense),
            LedgerCategory(id: "pay", name: "Salary", icon: "cash-outline", color: "#3E8E5E", kind: .income),
        ]
        ledger.trips = trips
        ledger.transactions = entries
        return ledger
    }

    @Test("whenTheYearHasNotStarted_YearReview_ShouldCountNoDaysAndBeEmpty")
    func futureYear() throws {
        let report = LedgerReport(ledger: Self.ledger([try Self.entry("a", 500, "2026-03-02")]))
        let review = report.yearReview(2027, today: try ContractLedger.date("2026-12-27"), households: [])
        #expect(review.isEmpty)
        // As on the web: the year would start on January 1, after today, so no day counts yet.
        #expect(review.from?.description == "2027-01-01")
        #expect(review.to.description == "2026-12-27")
        #expect(review.facts.daysWithoutSpending == 0)
        #expect(review.facts.perWeek == 0)
        #expect(review.monthlyAverage == 0)
        #expect(review.busiestMonth == nil)
        #expect(review.months.count == 12)
    }

    @Test("whenOnlyIncomeIsDatedAfterToday_YearReview_ShouldNotStartTheYearThere")
    func expectedIncome() throws {
        // Income dated after today is expected, so it is neither the first entry nor recorded.
        let report = LedgerReport(
            ledger: Self.ledger([try Self.entry("pay", 100_000, "2026-12-30", category: "pay", kind: .income)]))
        let review = report.yearReview(2026, today: try ContractLedger.date("2026-12-27"), households: [])
        #expect(review.isEmpty)
        #expect(review.from == nil)
        #expect(review.trips.list.isEmpty)
        #expect(review.trips.longestId == nil)
    }

    @Test("whenATripStartsBeforeTheFirstEntry_YearReview_ShouldClipItsDaysToTheCountedRange")
    func clipping() throws {
        let trips = [
            PennyDomain.Trip(
                id: "t", name: "Secret trip", startDate: try ContractLedger.date("2026-03-01"),
                endDate: try ContractLedger.date("2026-03-10")),
            // After today: no days yet, so not listed.
            PennyDomain.Trip(
                id: "later", name: "Later", startDate: try ContractLedger.date("2026-12-28"),
                endDate: try ContractLedger.date("2026-12-30")),
        ]
        let report = LedgerReport(
            ledger: Self.ledger(
                [try Self.entry("a", 1_000, "2026-03-05", trip: "t"), try Self.entry("b", 300, "2026-03-07")],
                trips: trips))
        let review = report.yearReview(2026, today: try ContractLedger.date("2026-12-27"), households: [])
        #expect(review.from?.description == "2026-03-05")
        #expect(review.trips.list.map(\.id) == ["t"])
        #expect(review.trips.list.first?.days == 6, "March 5 to 10")
        #expect(review.trips.daysAway == 6)
        #expect(review.trips.share == 1_000)
        #expect(review.facts.busiestWeekday == 4, "2026-03-05 is a Thursday")
        #expect(review.facts.longestRun?.start.description == "2026-03-08", "from the day after the last expense")
        #expect(review.facts.longestRun?.end.description == "2026-12-27", "up to today")
    }
}
