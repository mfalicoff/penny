import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Activity filters and local search (MAZ-73)")
struct ActivityFiltersTests {
    struct FoldCase: Decodable {
        var name: String
        var input: String
        var expected: String
    }

    struct FoldCases: Decodable {
        var foldCases: [FoldCase]
    }

    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest)

    static func report(_ entries: [LedgerEntry]) -> LedgerReport {
        LedgerReport(ledger: Ledger(accounts: [Sample.visa], transactions: entries))
    }

    @Test("whenSharedFoldCases_SearchText_ShouldNormalizeLikeTheServer")
    func foldCases() throws {
        let cases = try JSONDecoder().decode(FoldCases.self, from: Fixtures.data("search-cases.json")).foldCases
        #expect(cases.count >= 20)
        for item in cases {
            #expect(
                Array(SearchText.normalize(item.input).unicodeScalars) == Array(item.expected.unicodeScalars),
                "\(item.name)")
        }
    }

    @Test("whenAQueryHasAccentsOrSpansFields_FoldedSearch_ShouldMatchTitleThenDocument")
    func foldedMatching() {
        let report = Self.report([
            Sample.entry("a", "2026-11-02", title: "Café tickets"),
            Sample.entry("b", "2026-11-03", title: "Coffee beans", note: "Morning", accountId: "visa"),
            Sample.entry("c", "2026-11-04", title: "Rent"),
        ])
        let index = FoldedSearchIndex(report)
        func ids(_ query: String) -> [String] {
            report.activity(ActivityFilters(period: .month(Self.november), query: query), index: index).entries.map(
                \.id)
        }
        #expect(ids("CAFE") == ["a"], "accents are ignored")
        #expect(ids("beans morning") == ["b"], "the document joins the fields")
        #expect(ids("  VISA ") == ["b"], "the account name is searched")
        #expect(ids("coffee  beans") == ["b"], "whitespace runs fold to one space")
        #expect(ids("cofee").isEmpty, "typo matches need the server")
        #expect(ids("") == ["c", "b", "a"], "an empty query lists everything, newest first")
        let entries = report.recorded
        #expect(index.match(entries[0], needle: FoldedSearchIndex.needle("tickets")) == .title)
        #expect(index.match(entries[1], needle: FoldedSearchIndex.needle("morning")) == .text)
    }

    @Test("whenFiltersNarrowTheList_ActivityResult_ShouldKeepThePeriodTotals")
    func totalsIgnoreFilters() {
        let report = Self.report([
            Sample.entry("a", "2026-11-02", share: 1000, category: "groceries", title: "Groceries"),
            Sample.entry("b", "2026-11-03", share: 300_000, kind: .income, title: "Payday"),
            Sample.entry("c", "2026-11-03", share: 20_000, kind: .investment, title: "TFSA"),
            Sample.entry("d", "2026-10-30", share: 5000, title: "October"),
        ])
        let index = FoldedSearchIndex(report)
        let whole = report.activity(ActivityFilters(period: .month(Self.november)), index: index)
        #expect(whole.summary == KindTotals(expense: 1000, income: 300_000, investment: 20_000))
        #expect(whole.entries.map(\.id) == ["b", "c", "a"])
        let narrowed: [ActivityFilters] = [
            ActivityFilters(period: .month(Self.november), kind: .expense),
            ActivityFilters(period: .month(Self.november), categoryId: "groceries"),
            ActivityFilters(period: .month(Self.november), day: .day("2026-11-03")),
            ActivityFilters(period: .month(Self.november), query: "payday"),
        ]
        for filters in narrowed {
            #expect(report.activity(filters, index: index).summary == whole.summary)
        }
        #expect(report.activity(narrowed[0], index: index).entries.map(\.id) == ["a"])
        #expect(report.activity(narrowed[2], index: index).entries.map(\.id) == ["b", "c"])
        #expect(report.activity(ActivityFilters(period: .year(2026)), index: index).entries.count == 4)
        #expect(report.activity(ActivityFilters(period: .allTime), index: index).summary.expense == 6000)
        #expect(report.totals(.month(Self.november)) == whole.summary)
    }

    @Test("whenThePeriodOrKindChanges_ActivityFilters_ShouldDropADayOrCategoryThatNoLongerFits")
    func filterRules() {
        var filters = ActivityFilters(period: .month(Self.november), day: .day("2026-11-03"), kind: .expense)
        filters.categoryId = "food"
        #expect(filters.isNarrowed)
        #expect(filters.dateRange.from == .day("2026-11-03") && filters.dateRange.to == .day("2026-11-03"))
        filters.kind = .income
        #expect(filters.categoryId == nil, "a category belongs to one kind")
        filters.period = .year(2026)
        #expect(filters.day == .day("2026-11-03"), "the day is still in the period")
        filters.period = .year(2025)
        #expect(filters.day == nil)
        #expect(filters.dateRange.from == .day("2025-01-01") && filters.dateRange.to == .day("2025-12-31"))
        filters.period = .allTime
        #expect(filters.dateRange.from == nil && filters.dateRange.to == nil)
        filters.clearNarrowing()
        #expect(!filters.isNarrowed)
        #expect(ActivityFilters(period: .month(Self.november), day: .day("2026-10-01")).day == nil)
        #expect(!ActivityFilters(period: .allTime, query: " \u{3000} ").hasQuery)
    }

    @Test("whenChangesArePending_FoldedSearch_ShouldFindLocalCreatesAndHideLocalDeletes")
    func pendingWork() throws {
        let cases = try LocalSearchCases.load()
        let month = try #require(MonthKey(year: 2026, month: 11))
        for item in cases.pendingCases {
            var local = try ContractLedger.ledger(cases.ledger)
            if let create = item.localCreate { local.transactions.append(try ContractLedger.entry(create)) }
            if let id = item.editId, let index = local.transactions.firstIndex(where: { $0.id == id }) {
                for (key, value) in item.patch ?? [:] {
                    if key == "note" { local.transactions[index].note = value }
                    if key == "title" { local.transactions[index].title = value }
                }
            }
            if let id = item.deleteId { local.transactions.removeAll { $0.id == id } }
            let report = LedgerReport(ledger: local)
            let ids = report.activity(
                ActivityFilters(period: .month(month), query: item.query), index: FoldedSearchIndex(report)
            ).entries.map(\.id)
            // The pending fixtures use plain ASCII queries, where folding and the legacy rule agree.
            #expect(ids == item.expectedIds, "\(item.name)")
        }
    }

    @Test("whenRowsAreGrouped_ActivityDay_ShouldKeepOrderAndNetEachDay")
    func days() {
        let entries = Self.report([
            Sample.entry("a", "2026-11-03", share: 1000),
            Sample.entry("b", "2026-11-03", share: 5000, kind: .income),
            Sample.entry("c", "2026-11-01", share: 200),
        ]).activity(ActivityFilters(period: .allTime), index: FoldedSearchIndex()).entries
        let days = ActivityDay.group(entries)
        #expect(days.map(\.date) == [.day("2026-11-03"), .day("2026-11-01")])
        #expect(days.map(\.net) == [4000, -200])
        #expect(days.flatMap(\.entries) == entries)
    }
}
