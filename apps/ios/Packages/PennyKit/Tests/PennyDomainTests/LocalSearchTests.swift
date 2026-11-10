import PennyContracts
import PennyDomain
import Testing

@Suite("Local search")
struct LocalSearchTests {
    static let november = MonthKey(year: 2026, month: 11)

    @Test("whenLegacySubstringCase_Activity_ShouldMatchSearchFixture")
    func substringCases() throws {
        let cases = try LocalSearchCases.load()
        let report = LedgerReport(ledger: try ContractLedger.ledger(cases.ledger))
        let month = try #require(Self.november)
        let totals = report.activity(.month(month)).summary
        #expect(cases.substringCases.count >= 9)
        for item in cases.substringCases {
            let page = report.activity(
                .month(month), query: item.query, kind: try item.kind.map(ContractLedger.kind),
                day: try item.day.map(ContractLedger.date), page: item.page ?? 0)
            #expect(page.entries.map(\.id) == item.ids, "query \(item.query.debugDescription)")
            if let count = item.totalCount { #expect(page.totalCount == count) }
            #expect(page.summary == totals, "query and kind never change period totals")
        }
    }

    @Test("whenPendingCreateEditOrDelete_Activity_ShouldSearchTheLocalSnapshot")
    func pendingCases() throws {
        let cases = try LocalSearchCases.load()
        let month = try #require(Self.november)
        for item in cases.pendingCases {
            var local = try ContractLedger.ledger(cases.ledger)
            if let create = item.localCreate { local.transactions.append(try ContractLedger.entry(create)) }
            if let id = item.editId, let index = local.transactions.firstIndex(where: { $0.id == id }) {
                for (key, value) in item.patch ?? [:] {
                    switch key {
                    case "note": local.transactions[index].note = value
                    case "title": local.transactions[index].title = value
                    default: Issue.record("unexpected patch key \(key)")
                    }
                }
            }
            if let id = item.deleteId { local.transactions.removeAll { $0.id == id } }
            let ids = LedgerReport(ledger: local).activity(.month(month), query: item.query).entries.map(\.id)
            #expect(ids == item.expectedIds, "\(item.name)")
        }
    }

    @Test("whenSeedHasPendingEdits_Activity_ShouldMatchTheSeedsLocalSearch")
    func seededPendingEdits() throws {
        let (scenario, base) = try ContractLedger.alexSeed()
        let pending = try #require(scenario.pendingEdits)
        var local = base
        local.transactions += try pending.create.map(ContractLedger.entry)
        for edit in pending.edit {
            let index = try #require(local.transactions.firstIndex { $0.id == edit.id })
            for (key, value) in edit.patch {
                guard key == "title", case .string(let title) = value else {
                    Issue.record("unexpected patch \(key)")
                    continue
                }
                local.transactions[index].title = title
            }
        }
        local.transactions.removeAll { pending.delete.contains($0.id) }
        let report = LedgerReport(ledger: local)
        for search in pending.localSearch {
            let ids = report.activity(.year(2026), query: search.query).entries.map(\.id)
            #expect(ids == search.expectedIds, "query \(search.query)")
        }
        // The base snapshot (what the server has) still finds the deleted and pre-edit rows:
        // only the local snapshot may answer while changes are pending.
        #expect(LedgerReport(ledger: base).activity(.year(2026), query: "crème").entries.map(\.id) == ["p-cafe"])
        #expect(LocalSearch.searchesLocally(hasPendingChanges: true, isOnline: true, serverHasSearch: true))
        #expect(LocalSearch.searchesLocally(hasPendingChanges: false, isOnline: false, serverHasSearch: true))
        #expect(LocalSearch.searchesLocally(hasPendingChanges: false, isOnline: true, serverHasSearch: false))
        #expect(!LocalSearch.searchesLocally(hasPendingChanges: false, isOnline: true, serverHasSearch: true))
    }

    @Test("whenTextNeedsExactMatching_LocalSearch_ShouldCompareCodeUnitsAfterLowercasing")
    func exactMatching() {
        func match(_ query: String, title: String) -> Bool {
            LocalSearch.matches(query: query, title: title, note: "", categoryName: "", accountName: "")
        }
        #expect(match("CAFÉ", title: "Café"))
        #expect(!match("cafe", title: "Café"), "no accent folding")
        // Composed "é" (U+00E9) and decomposed "e\u{301}" are different code units, as in JavaScript.
        #expect(!match("caf\u{E9}", title: "Cafe\u{301}"))
        #expect(match("東京", title: "東京 ramen"))
        #expect(match("🎉", title: "🎉 Party supplies"))
        #expect(match("", title: "anything"))
        #expect(match("  ", title: "anything"), "a blank query is trimmed to empty and matches all")
        #expect(match("o c", title: "Rent") == false)
        // Fields are joined with single spaces, so a query can span title and note.
        #expect(
            LocalSearch.matches(query: "rent old", title: "Rent", note: "Old note", categoryName: "", accountName: ""))
    }

    /// v2 `searchMatcher` (src/domain/search.ts): Home, Activity and whole-ledger search trim
    /// and lowercase the query identically (the old `selectOverview` did not trim). Fields are
    /// joined by single spaces, so a query can cross fields but cannot skip one.
    @Test("whenQueryHasSurroundingSpacesOrCrossesFields_HomeActivityAndSearch_ShouldMatchIdentically")
    func everyScreenTrims() throws {
        let month = try #require(MonthKey("2026-09"))
        let report = LedgerReport(
            ledger: Sample.ledger(transactions: [
                Sample.entry("t", "2026-09-20", title: "Lunch", note: "With Alex", accountId: "visa")
            ]))
        let home = report.month(month)
        for query in [
            "lunch ", "  LUNCH", "lunch with", "with alex", "Lunch With", "alex food & drinks visa", " ", "   ", "",
        ] {
            #expect(report.monthEntries(home, query: query).map(\.id) == ["t"], "home \(query.debugDescription)")
            #expect(report.activity(.month(month), query: query).entries.map(\.id) == ["t"], "activity \(query)")
            #expect(report.search(query).map(\.id) == ["t"], "search \(query.debugDescription)")
        }
        #expect(report.monthEntries(home, query: "lunch  with").isEmpty, "one space joins the fields")
        #expect(report.search("lunch  with").isEmpty)
    }

    /// v2 `searchEntries`: recorded entries of the whole ledger (any month), filtered by kind
    /// and day, newest first then id. It has no pages, so the paged case lists every match.
    @Test("whenLegacySubstringCase_Search_ShouldMatchSearchFixtureAcrossTheLedger")
    func searchEntries() throws {
        let cases = try LocalSearchCases.load()
        let report = LedgerReport(ledger: try ContractLedger.ledger(cases.ledger))
        for item in cases.substringCases {
            let found = report.search(
                item.query, kind: try item.kind.map(ContractLedger.kind), day: try item.day.map(ContractLedger.date))
            #expect(found.map(\.id) == item.ids, "query \(item.query.debugDescription)")
        }
        // Independent expectation: "coffee" hits a, b and e, all dated 2026-11-02, so id order.
        #expect(report.search("coffee").map(\.id) == ["a", "b", "e"])
        // Previews are never history; a recorded occurrence is, in any month.
        let ledger = Sample.ledger(
            transactions: [Sample.entry("rent:2026-09-30", "2026-09-30", title: "Rent", recurringId: "rent")],
            recurring: [Sample.rule("rent", start: "2026-09-30", next: "2026-10-31", anchorDay: 31)])
        let rent = LedgerReport(ledger: ledger, sharedScheduled: [ReportTests.streaming("2026-10-20")])
        #expect(rent.search("r").map(\.id) == ["rent:2026-09-30"])
        #expect(rent.month(try #require(MonthKey("2026-10"))).scheduled.count == 2, "both previews exist")
    }
}
