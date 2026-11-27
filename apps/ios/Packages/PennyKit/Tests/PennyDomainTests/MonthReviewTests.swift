import Foundation
import PennyContracts
import PennyDomain
import Testing

/// The monthly recap (MAZ-292) against contracts/fixtures/month-review.json, generated from the
/// web's `monthReview` (apps/web/src/domain/monthReview.ts), and the rules around it.
@Suite("Monthly recap")
struct MonthReviewTests {
    /// A projection row as the app reads it (`SharedExpenseShare(wire:currency:)`): in the
    /// household's currency, scheduled or recorded, with who paid already resolved.
    static func share(_ row: MonthReviewFixture.ProjectedExpense) throws -> SharedExpenseShare {
        SharedExpenseShare(
            id: row.id, householdId: row.householdId,
            currency: try #require(Currency(rawValue: row.householdCurrency)), title: row.title,
            date: try ContractLedger.date(row.date), total: row.totalCents, share: row.shareCents,
            category: .init(name: row.category.name, icon: row.category.icon, color: row.category.color),
            note: row.note, householdName: row.householdName, recurringId: row.recurringId,
            scheduled: row.scheduled ?? false, payer: payer(paidByYou: row.paidByYou, row.payer))
    }

    /// "you" when the viewer paid, else the shown name: a display name, else the email, and
    /// "Former member" for a deleted account (PennyData's `WireExpensePayer.shownName`).
    static func payer(paidByYou: Bool?, _ payer: MonthReviewFixture.Payer?) -> SharedPayer? {
        if paidByYou == true { return .you }
        guard let payer else { return nil }
        if payer.deleted == true { return .member(name: "Former member") }
        let name = payer.displayName ?? ""
        return .member(name: name.isEmpty ? payer.email : name)
    }

    static func report(_ fixture: MonthReviewFixture, _ item: MonthReviewFixture.Case) throws -> LedgerReport {
        let ledger = try ContractLedger.ledger(try #require(fixture.ledgers[item.ledger]))
        let rows = try #require(fixture.projections[item.projection]).map(share)
        return LedgerReport(ledger: ledger, shared: rows)
    }

    @Test("whenFixtureCasesAreReviewed_MonthReview_ShouldMatchTheWebRule")
    func fixture() throws {
        let fixture = try Fixtures.decode(MonthReviewFixture.self, from: "month-review.json")
        #expect(fixture.cases.count >= 7)
        for item in fixture.cases {
            let expected = item.expected
            let review = try Self.report(fixture, item)
                .review(try #require(MonthKey(item.month)), today: try ContractLedger.date(item.today))
            let name = item.name
            #expect(review.month.description == expected.month, "\(name)")
            #expect(review.isEmpty == expected.empty, "\(name)")
            #expect(review.spent == expected.spent, "\(name)")
            #expect(review.cameIn == expected.cameIn, "\(name)")
            #expect(review.invested == expected.invested, "\(name)")
            #expect(review.leftOver == expected.leftOver, "\(name)")
            for (actual, wanted) in [(review.previous, expected.previous), (review.lastYear, expected.lastYear)] {
                #expect(actual.month?.description == wanted.month, "\(name)")
                #expect(actual.spent == wanted.spent, "\(name): \(wanted.month)")
                #expect(actual.change == wanted.change, "\(name): \(wanted.month)")
            }
            #expect(
                review.biggestChanges.map {
                    "\($0.key)|\($0.name)|\($0.icon)|\($0.color)|\($0.current)|\($0.previous)|\($0.change)|\($0.percent.map(String.init) ?? "new")"
                }
                    == expected.biggestChanges.map {
                        "\($0.key)|\($0.name)|\($0.icon)|\($0.color)|\($0.current)|\($0.previous)|\($0.change)|\($0.percent.map(String.init) ?? "new")"
                    }, "\(name)")
            #expect(review.shared.count == expected.shared.count, "\(name)")
            #expect(review.shared.spent == expected.shared.spent, "\(name)")
            #expect(review.shared.top?.id == expected.shared.top?.id, "\(name)")
            if let top = review.shared.top, let wanted = expected.shared.top {
                #expect(top.title == wanted.title)
                #expect(top.categoryId == wanted.categoryId)
                #expect(top.date.description == wanted.date)
                #expect(top.share == wanted.share)
                #expect(top.total == wanted.total)
                #expect(top.payer == Self.payer(paidByYou: wanted.paidByYou, wanted.payer))
            }
            #expect(review.split.count == expected.split.count, "\(name)")
            #expect(review.split.total == expected.split.total, "\(name)")
            #expect(review.split.share == expected.split.share, "\(name)")
            #expect(review.split.othersPaid == expected.split.othersPaid, "\(name)")
            #expect(review.daysWithoutSpending == expected.daysWithoutSpending, "\(name)")
            #expect(review.longestRun?.start.description == expected.longestRun?.start, "\(name)")
            #expect(review.longestRun?.end.description == expected.longestRun?.end, "\(name)")
            #expect(review.longestRun?.days == expected.longestRun?.days, "\(name)")
        }
    }

    @Test("whenTheDayOfTheMonthIsSevenOrLess_RecapBanner_ShouldOfferLastMonth")
    func banner() throws {
        let fixture = try Fixtures.decode(MonthReviewFixture.self, from: "month-review.json")
        for item in fixture.banner {
            let month = MonthReview.bannerMonth(today: try ContractLedger.date(item.today))
            #expect(month?.description == item.month, "\(item.today)")
        }
    }

    @Test("whenPercentagesAreRounded_ReviewPercent_ShouldRoundHalfAwayFromZero")
    func percentages() {
        #expect(ReviewPercent.change(after: 105, before: 100) == 5)
        #expect(ReviewPercent.change(after: 1_005, before: 1_000) == 1, "0.5 rounds away from zero")
        #expect(ReviewPercent.change(after: 995, before: 1_000) == -1, "-0.5 rounds away from zero")
        #expect(ReviewPercent.change(after: 9_999, before: 10_000) == 0, "a tiny drop is 0, never -0")
        #expect(ReviewPercent.change(after: 5, before: 0) == nil, "nothing before: no percent, never infinity")
        #expect(ReviewPercent.change(after: 5, before: nil) == nil)
        #expect(ReviewPercent.change(after: 0, before: 60) == -100)
        #expect(ReviewPercent.of(1, 3) == 33)
        #expect(ReviewPercent.of(1, 2) == 50)
        #expect(ReviewPercent.of(5, 0) == 0)
    }

    @Test("whenManyCategoriesMove_CategoryChange_ShouldGroupTheSmallestIntoMore")
    func grouping() throws {
        let current = (1...10).map {
            CategorySpending(id: "c\($0)", name: "C\($0)", icon: "", color: "", amount: Int64($0) * 100)
        }
        let rows = CategoryChange.compare(current: current, previous: [])
        #expect(rows.count == 9)
        let more = try #require(rows.last)
        #expect(more.key == "more")
        #expect(more.name == "2 more")
        #expect(more.current == 300, "C1 and C2")
        #expect(CategoryChange.compare(current: current, previous: [], limit: nil).count == 10)
        // Names match trimmed and without case; the first one seen names the row.
        let merged = CategoryChange.compare(
            current: [CategorySpending(id: "a", name: " Food ", icon: "", color: "", amount: 10)],
            previous: [CategorySpending(id: "b", name: "food", icon: "", color: "", amount: 4)])
        #expect(merged.map(\.key) == ["food"])
        #expect(merged.first?.categoryId == "a")
        #expect(merged.first?.change == 6)
    }

    @Test("whenSpendingChanged_SpendingChange_ShouldNameAtMostTwoCategoriesThatMovedThatWay")
    func drivers() {
        func row(_ name: String, _ current: Int64, _ previous: Int64) -> CategoryChange {
            CategoryChange(
                key: name.lowercased(), categoryId: name, name: name, icon: "", color: "", current: current,
                previous: previous, share: 0)
        }
        let rows = [row("Home", 110, 100), row("Food", 20, 60), row("Shopping", 10, 30), row("Fun", 5, 10)]
        #expect(SpendingChange(current: 145, previous: 200, comparison: rows).drivers == ["Food", "Shopping"])
        #expect(SpendingChange(current: 210, previous: 200, comparison: rows).drivers == ["Home"])
        #expect(SpendingChange(current: 200, previous: 200, comparison: rows).drivers.isEmpty)
    }

    @Test("whenTheMonthHasNotStarted_MonthReview_ShouldCountNoQuietDays")
    func futureMonth() throws {
        let report = LedgerReport(ledger: Ledger())
        let month = try #require(MonthKey("2026-12"))
        let review = report.review(month, today: try #require(CalendarDate("2026-11-20")))
        #expect(review.isEmpty)
        #expect(review.daysWithoutSpending == 0)
        #expect(review.longestRun == nil)
        #expect(review.previous.spent == nil, "nothing recorded at all: nothing to compare with")
    }
}
