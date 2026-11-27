import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// MAZ-151: `GET /api/rates`, the rate lookups behind the entry form, the ledger-derived recent
/// currencies and the replacement of provisional rates after a sync.
@Suite("Exchange rates")
struct ExchangeRateTests {
    static let ratesJSON = """
        {"enabled":true,"source":"European Central Bank","base":"CAD","date":"2026-11-03",
        "rateDate":"2026-11-03","provisional":false,"latestDate":"2026-11-06",
        "rates":{"EUR":"1.4612","USD":"1.373","JPY":"0.00906283","XYZ":"1.40"}}
        """

    static func day(_ text: String) -> PennyDomain.CalendarDate {
        guard let date = PennyDomain.CalendarDate(text) else { preconditionFailure(text) }
        return date
    }

    static func answer(
        enabled: Bool = true, date: String = "2026-11-03", rateDate: String? = "2026-11-03", provisional: Bool = false,
        rates: [String: String] = ["EUR": "1.4612"]
    ) -> WireExchangeRates {
        WireExchangeRates(
            enabled: enabled, source: enabled ? "European Central Bank" : nil, base: "CAD", date: date,
            rateDate: rateDate, provisional: provisional, latestDate: rateDate, rates: enabled ? rates : [:])
    }

    /// Answers from a closure and counts the calls.
    final class FakeRates: ExchangeRateService {
        let calls = Mutex(0)
        let handler: @Sendable (String, PennyDomain.CalendarDate?) throws -> WireExchangeRates

        init(_ handler: @escaping @Sendable (String, PennyDomain.CalendarDate?) throws -> WireExchangeRates) {
            self.handler = handler
        }

        func rates(base: String, date: PennyDomain.CalendarDate?) async throws -> WireExchangeRates {
            calls.withLock { $0 += 1 }
            return try handler(base, date)
        }
    }

    @Test("whenAskedForADate_ExchangeRates_ShouldSendTheBaseAndDateAndDecodeTheAnswer")
    func request() async throws {
        let transport = StubTransport(json: Self.ratesJSON)
        let rates = try await APIFixtures.client(transport: transport).exchangeRates(
            base: "CAD", date: Self.day("2026-11-03"))
        #expect(rates.rateDate == "2026-11-03")
        #expect(
            rates.choice(for: "EUR") == RateChoice(rate: "1.4612", status: .published, date: Self.day("2026-11-03")))
        // A value that isn't canonical is never used.
        #expect(rates.choice(for: "XYZ") == nil)
        let url = try #require(transport.sent.first?.url?.absoluteString)
        #expect(url == "https://penny.example.test/api/rates?base=CAD&date=2026-11-03")
    }

    @Test("whenTheBaseIsUnknownOrTheAnswerIsForAnotherBase_ExchangeRates_ShouldFail")
    func refusals() async throws {
        let transport = StubTransport(json: Self.ratesJSON)
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.invalidRequest(.invalidField("base"))) {
            try await client.exchangeRates(base: "XXX", date: nil)
        }
        #expect(transport.sent.isEmpty)
        await #expect(throws: APIError.malformedResponse) { try await client.exchangeRates(base: "USD", date: nil) }
    }

    @Test("whenTheServerAnswers_RateLookup_ShouldFindThePublishedOrProvisionalRate")
    @MainActor
    func lookups() async {
        let model = ExchangeRateModel(
            service: FakeRates { _, date in
                date == Self.day("2026-11-09")
                    ? Self.answer(
                        date: "2026-11-09", rateDate: "2026-11-06", provisional: true, rates: ["EUR": "1.463"])
                    : Self.answer()
            })
        #expect(
            await model.lookup("EUR", home: .cad, date: Self.day("2026-11-03"))
                == .found(
                    RateChoice(rate: "1.4612", status: .published, date: Self.day("2026-11-03")),
                    source: "European Central Bank"))
        #expect(
            await model.lookup("EUR", home: .cad, date: Self.day("2026-11-09"))
                == .found(
                    RateChoice(rate: "1.463", status: .provisional, date: Self.day("2026-11-06")),
                    source: "European Central Bank"))
        // A currency the source doesn't quote needs a typed rate.
        #expect(await model.lookup("KWD", home: .cad, date: Self.day("2026-11-03")) == .unavailable)
    }

    @Test("whenFetchingIsOffOrTheServerIsOld_RateLookup_ShouldAskForARate")
    @MainActor
    func off() async {
        let off = ExchangeRateModel(service: FakeRates { _, _ in Self.answer(enabled: false, rateDate: nil) })
        #expect(await off.lookup("EUR", home: .cad, date: Self.day("2026-11-03")) == .off)
        let old = ExchangeRateModel(service: FakeRates { _, _ in throw APIError.notFound(message: nil) })
        #expect(await old.lookup("EUR", home: .cad, date: Self.day("2026-11-03")) == .off)
    }

    @Test("whenOffline_RateLookup_ShouldUseTheLastAnswerProvisionallyAndKeepItAcrossLaunches")
    @MainActor
    func offline() async throws {
        let suite = "penny.tests.rates.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let online = ExchangeRateModel(service: FakeRates { _, _ in Self.answer() }, defaults: defaults)
        _ = await online.lookup("EUR", home: .cad, date: Self.day("2026-11-03"))
        // A later launch, offline.
        let offline = ExchangeRateModel(service: FakeRates { _, _ in throw APIError.offline }, defaults: defaults)
        #expect(
            await offline.lookup("EUR", home: .cad, date: Self.day("2026-11-09"))
                == .found(
                    RateChoice(rate: "1.4612", status: .provisional, date: Self.day("2026-11-03")),
                    source: "European Central Bank"))
        let nothing = ExchangeRateModel(service: FakeRates { _, _ in throw APIError.offline })
        #expect(await nothing.lookup("EUR", home: .cad, date: Self.day("2026-11-09")) == .unavailable)
    }

    @Test("whenTheLedgerHasEntriesInOtherCurrencies_CurrencyUsage_ShouldCountThemAndKeepTheLatestRate")
    func usage() {
        func entry(_ id: String, _ date: String, _ code: String, rate: String) -> LedgerEntry {
            LedgerEntry(
                id: id, title: id, kind: .expense, total: 100, share: 100, categoryId: "food", date: Self.day(date),
                originalAmount: 100, originalCurrency: code, rate: rate, rateStatus: .edited)
        }
        let ledger = Ledger(transactions: [
            entry("a", "2026-11-03", "EUR", rate: "1.46"), entry("b", "2026-10-02", "USD", rate: "1.37"),
            entry("c", "2026-11-01", "EUR", rate: "1.45"), entry("d", "2026-11-06", "EUR", rate: "1.463"),
        ])
        let usage = CurrencyUsage(ledger)
        #expect(usage.uses.map(\.code) == ["EUR", "USD"])
        #expect(usage.uses.map(\.count) == [3, 1])
        #expect(usage.lastRate("EUR") == "1.463")
        #expect(usage.lastRate("JPY") == nil)
        #expect(CurrencyUsage(Ledger()).uses.isEmpty)
    }

    @Test("whenTheServerPublishedTheDaysRate_ProvisionalRates_ShouldConvertAgainButNeverAnEditedRate")
    func finalize() throws {
        let museum = LedgerEntry(
            id: "museum", title: "Museum passes", kind: .expense, total: 7022, share: 7022, categoryId: "food",
            date: Self.day("2026-11-09"), originalAmount: 4800, originalCurrency: "EUR", rate: "1.463",
            rateStatus: .provisional, rateDate: Self.day("2026-11-06"))
        var edited = museum
        edited.id = "edited"
        edited.rateStatus = .edited
        edited.rateDate = nil
        let ledger = Ledger(transactions: [museum, edited])
        #expect(ProvisionalRates.dates(in: ledger) == [Self.day("2026-11-09")])
        let still = Self.answer(date: "2026-11-09", rateDate: "2026-11-06", provisional: true)
        #expect(ProvisionalRates.finalized(ledger, date: Self.day("2026-11-09"), answer: still).isEmpty)
        let published = Self.answer(date: "2026-11-09", rateDate: "2026-11-09", rates: ["EUR": "1.4655"])
        let updates = ProvisionalRates.finalized(ledger, date: Self.day("2026-11-09"), answer: published)
        #expect(updates.count == 1)
        let updated = try #require(updates.first?.updated)
        #expect(updated.total == 7034 && updated.share == 7034)
        #expect(updated.rate == "1.4655" && updated.rateStatus == .published)
        #expect(updated.rateDate == Self.day("2026-11-09"))
        // Saved in place, and only while the entry is unchanged.
        let next = try LedgerChange.finalizeRate(updated, original: museum).apply(to: ledger)
        #expect(next.transactions.map(\.id) == ["museum", "edited"])
        #expect(next.transactions[0] == updated)
        var changed = ledger
        changed.transactions[0].note = "Edited here"
        #expect(try LedgerChange.finalizeRate(updated, original: museum).apply(to: changed) == changed)
    }

    @Test("whenTheDemoAsks_SampleRates_ShouldQuoteAgainstTheHomeCurrency")
    func sample() async throws {
        let service = SampleExchangeRateService(latest: Self.day("2026-11-06"))
        let cad = try await service.rates(base: "CAD", date: Self.day("2026-11-09"))
        #expect(cad.rates["EUR"] == "1.4612")
        #expect(cad.provisional)
        let eur = try await service.rates(base: "EUR", date: Self.day("2026-11-03"))
        #expect(eur.rates["CAD"] == "0.684369")
        #expect(!eur.provisional)
    }

    @Test("whenAnEntryIsInAnotherCurrency_WireLedger_ShouldRoundTripItsFieldsAndOmitAbsentOnes")
    func wire() throws {
        let foreign = LedgerEntry(
            id: "e", title: "Cooking class", kind: .expense, total: 12_420, share: 12_420, categoryId: "food",
            date: Self.day("2026-11-03"), originalAmount: 8_500, originalCurrency: "EUR", rate: "1.4612",
            rateStatus: .edited)
        let home = LedgerEntry(
            id: "h", title: "Groceries", kind: .expense, total: 4_890, share: 4_890, categoryId: "food",
            date: Self.day("2026-11-03"))
        let wire = WireLedger(Ledger(transactions: [foreign, home]))
        let entries =
            try #require(
                try JSONSerialization.jsonObject(with: JSONEncoder().encode(wire)) as? [String: Any])["transactions"]
            as? [[String: Any]]
        #expect(entries?.first?["rate"] as? String == "1.4612")
        #expect(entries?.first?["rateDate"] == nil)
        #expect(entries?.last?["originalAmount"] == nil)
        #expect(try Ledger(wire: wire).transactions == [foreign, home])
        var unknown = wire
        unknown.transactions[0].rateStatus = "manual"
        #expect(throws: LedgerMappingError.invalidValue(field: "transactions.rateStatus", value: "manual")) {
            try Ledger(wire: unknown)
        }
    }
}
