import Foundation
import PennyContracts
import PennyData
import PennyDomain
import Testing

@Suite("Wire models")
struct WireModelTests {
    static func entry(kind: String, total: String) -> String {
        """
        {"id":"e","title":"t","kind":"\(kind)","total":\(total),"share":0,"categoryId":"c",
        "date":"2026-01-01","note":""}
        """
    }

    @Test("whenFixtureLedger_WireLedger_ShouldRoundTripWithoutLoss")
    func ledgerRoundTrips() throws {
        let data = try APIFixtures.member("search-cases.json", "ledger")
        let ledger = try JSONDecoder().decode(WireLedger.self, from: data)
        let again = try JSONDecoder().decode(WireLedger.self, from: JSONEncoder().encode(ledger))
        #expect(again == ledger)
        #expect(ledger.version == 4)
        #expect(ledger.transactions.first?.total == 1000)
        #expect(ledger.transactions.first?.share == 500)
    }

    @Test("whenFixtureLedger_DomainLedger_ShouldMapVersionFour")
    func fixtureLedgerMaps() throws {
        let wire = try JSONDecoder().decode(WireLedger.self, from: APIFixtures.member("search-cases.json", "ledger"))
        let ledger = try PennyDomain.Ledger(wire: wire)
        #expect(ledger.transactions.count == wire.transactions.count)
    }

    @Test("whenLedgerVersionIsNotFour_DomainLedger_ShouldRefuseIt", arguments: [0, 1, 2, 3, 5])
    func otherVersionsRefused(version: Int) throws {
        var wire = try JSONDecoder().decode(WireLedger.self, from: APIFixtures.member("search-cases.json", "ledger"))
        wire.version = version
        #expect(throws: LedgerMappingError.unsupportedVersion(version)) { try PennyDomain.Ledger(wire: wire) }
    }

    @Test("whenARuleHasNoAnchorDay_DomainLedger_ShouldRefuseIt")
    func missingAnchorDayRefused() throws {
        let wire = WireLedger(
            version: 4, currency: "CAD", categories: [], transactions: [],
            recurring: [
                WireRecurring(
                    id: "r", title: "Rent", kind: .expense, total: 1000, share: 1000, categoryId: "home",
                    date: "2026-01-01", note: "", frequency: "monthly", nextDate: "2026-02-01", active: true)
            ])
        #expect(throws: LedgerMappingError.invalidValue(field: "recurring.anchorDay", value: "missing")) {
            try PennyDomain.Ledger(wire: wire)
        }
    }

    @Test("whenDateAndMoney_WireEntry_ShouldKeepDateStringAndIntegerCents")
    func preservesDateAndCents() throws {
        let json = """
            {"id":"e1","title":"Rent","kind":"expense","total":99999999999,"share":0,"categoryId":"c",
             "date":"2026-02-28","note":""}
            """
        let entry = try JSONDecoder().decode(WireEntry.self, from: Data(json.utf8))
        #expect(entry.total == 99_999_999_999)
        #expect(entry.date == "2026-02-28")
        #expect(entry.accountId == nil)
        let object = try APIFixtures.object(JSONEncoder().encode(entry))
        #expect(object["accountId"] == nil)
        #expect(object["date"] as? String == "2026-02-28")
    }

    @Test(
        "whenMalformedEntry_WireEntry_ShouldFailToDecode",
        arguments: [
            WireModelTests.entry(kind: "refund", total: "1"),
            WireModelTests.entry(kind: "expense", total: "1.5"),
            WireModelTests.entry(kind: "expense", total: "\"10\""),
            #"{"id":"e","title":"t","kind":"expense","total":1,"share":0,"date":"2026-01-01","note":""}"#,
        ])
    func malformedEntry(json: String) {
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(WireEntry.self, from: Data(json.utf8)) }
    }

    @Test("whenUnknownMembers_WireEntry_ShouldIgnoreThemForForwardCompatibility")
    func ignoresUnknownMembers() throws {
        let json = """
            {"id":"e","title":"t","kind":"income","total":1,"share":0,"categoryId":"c",
             "date":"2026-01-01","note":"","future":{"a":1}}
            """
        #expect(try JSONDecoder().decode(WireEntry.self, from: Data(json.utf8)).kind == .income)
    }

    @Test("whenSharedFixtureResponse_SearchResponse_ShouldDecodeAndRoundTrip")
    func searchResponseFixture() throws {
        let data = try APIFixtures.member("search-cases.json", "response")
        let response = try JSONDecoder().decode(SearchResponse.self, from: data)
        #expect(response.version == 1)
        #expect(response.totalCount == 1)
        #expect(response.nextCursor == nil)
        let item = try #require(response.items.first)
        #expect(item.key == "personal:a")
        #expect(item.match == .meaning)
        #expect(item.source == .personal)
        let again = try JSONDecoder().decode(SearchResponse.self, from: JSONEncoder().encode(response))
        #expect(again == response)
    }

    @Test("whenSharedSource_SearchItem_ShouldDecodeProjectedExpense")
    func sharedItem() throws {
        let json = """
            {"key":"shared:x1","source":"shared","match":null,"entry":{"id":"x1","householdId":"h","title":"Dinner",
             "date":"2026-03-01","totalCents":1200,"shareCents":600,"payerUserId":"u",
             "category":{"name":"Food","icon":"cafe-outline","color":"#E47850"},"note":""}}
            """
        let item = try JSONDecoder().decode(SearchItem.self, from: Data(json.utf8))
        guard case .shared(let expense) = item.payload else {
            Issue.record("expected a shared payload")
            return
        }
        #expect(expense.shareCents == 600)
        #expect(item.match == nil)
    }

    @Test(
        "whenKeyDoesNotMatchSource_SearchItem_ShouldFailToDecode",
        arguments: [
            #"{"key":"shared:a","source":"personal","match":null,"entry":{}}"#,
            #"{"key":"personal:","source":"personal","match":null,"entry":{}}"#,
            #"{"key":"personal:a","source":"all","match":null,"entry":{}}"#,
            #"{"key":"personal:a","source":"personal","match":"fuzzy","entry":{}}"#,
        ])
    func badSearchItem(json: String) {
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(SearchItem.self, from: Data(json.utf8)) }
    }

    @Test("whenOptionalsAreNil_SearchRequest_ShouldOmitThemFromJSON")
    func requestOmitsNil() throws {
        let request = SearchRequest(query: "coffee", sort: .amountAscending, pageSize: 10)
        let object = try APIFixtures.object(JSONEncoder().encode(request))
        #expect(Set(object.keys) == ["query", "sort", "pageSize"])
        #expect(object["sort"] as? String == "amount-asc")
    }

    @Test("whenSharedRequestFixtures_SearchRequest_ShouldDecodeAndPassClientValidation")
    func requestFixtures() async throws {
        let transport = StubTransport(
            json: #"{"version":1,"items":[],"totalCount":0,"nextCursor":null}"#)
        let client = try APIFixtures.client(transport: transport)
        for data in try APIFixtures.elements("search-cases.json", "requests") {
            let request = try JSONDecoder().decode(SearchRequest.self, from: data)
            _ = try await client.search(request)
        }
    }
}
