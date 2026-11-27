import Foundation
import PennyContracts
import PennyDomain
import Testing

/// Every case of contracts/fixtures/currency.json (MAZ-151) against the Swift rules, which port
/// apps/web/src/domain/currency.ts.
@Suite("Currencies")
struct CurrencyTests {
    static let fixture = Result { try Fixtures.decode(CurrencyFixture.self, from: "currency.json") }

    private func load() throws -> CurrencyFixture { try Self.fixture.get() }

    private func message(_ body: () throws -> Void) -> String? {
        do {
            try body()
            return nil
        } catch let error as LedgerRuleError {
            return error.message
        } catch {
            return "\(error)"
        }
    }

    @Test("whenGoldenCurrencyList_Currencies_ShouldMatchCodesNamesAndMinorUnits")
    func currencyList() throws {
        let fixture = try load()
        #expect(Currencies.all.map(\.code) == fixture.currencies.map(\.code))
        #expect(Currencies.all.map(\.name) == fixture.currencies.map(\.name))
        #expect(Currencies.all.map(\.minorUnits) == fixture.currencies.map(\.minorUnits))
        #expect(Currencies.homeCurrencies == fixture.homeCurrencies)
        #expect(Currency.allCases.map(\.rawValue) == fixture.homeCurrencies)
        #expect(Currencies.all.allSatisfy { !$0.countries.isEmpty })
    }

    @Test("whenGoldenParseCase_ParseAmount_ShouldReturnMinorUnitsOrTheSameError")
    func parse() throws {
        for item in try load().parse {
            if let amount = item.amount {
                #expect(
                    (try? Currencies.parseAmount(item.input, currency: item.currency)) == amount,
                    "\(item.input) \(item.currency)")
            } else {
                #expect(
                    message { _ = try Currencies.parseAmount(item.input, currency: item.currency) } == item.error,
                    "\(item.input) \(item.currency)")
            }
        }
    }

    @Test("whenGoldenRateCase_NormalizeRate_ShouldReturnTheCanonicalRateOrTheSameError")
    func rates() throws {
        for item in try load().rates {
            if let rate = item.rate {
                #expect((try? Currencies.normalizeRate(item.input)) == rate, "\(item.input)")
                #expect(Currencies.validRate(rate))
            } else {
                #expect(message { _ = try Currencies.normalizeRate(item.input) } == item.error, "\(item.input)")
            }
        }
    }

    @Test("whenStoredRateIsNotCanonical_ValidRate_ShouldBeFalse")
    func validRates() {
        for rate in ["1.4612", "0.00000001", "1", "999999999.99999999"] {
            #expect(Currencies.validRate(rate), "\(rate)")
        }
        for rate in ["0", "0.0", "1.40", "01", "1.", ".5", "1,4", "1e3", "-1", "", "1234567890", "1.123456789"] {
            #expect(!Currencies.validRate(rate), "\(rate)")
        }
    }

    @Test("whenGoldenConversionCase_ConvertAmount_ShouldRoundOnceHalfUp")
    func conversions() throws {
        for item in try load().conversions {
            #expect(
                (try? Currencies.convertAmount(item.amount, from: item.from, rate: item.rate, home: item.home))
                    == item.converted, "\(item.amount) \(item.from) at \(item.rate)")
        }
    }

    @Test("whenGoldenCrossRateCase_CrossRate_ShouldRoundToSixSignificantDigits")
    func crossRates() throws {
        for item in try load().crossRates {
            let rate = try Currencies.crossRate(fromPerBase: item.fromPerBase, toPerBase: item.toPerBase)
            #expect(rate == item.rate, "\(item.fromPerBase) → \(item.toPerBase)")
        }
        #expect(message { _ = try Currencies.crossRate(fromPerBase: "0", toPerBase: "1") } != nil)
    }

    @Test("whenGoldenRateDateCase_PublishedRateDate_ShouldPickTheLatestPublicationOnOrBefore")
    func rateDates() throws {
        for item in try load().rateDates {
            let found = Currencies.publishedRateDate(item.published, date: item.date)
            #expect(found?.date == item.expected?.date, "\(item.date)")
            #expect(found?.provisional == item.expected?.provisional, "\(item.date)")
        }
    }

    @Test("whenGoldenEntryAmountsCase_EntryAmounts_ShouldConvertTheTotalAndShareOrFail")
    func entryAmounts() throws {
        for item in try load().entryAmounts {
            let mode = try #require(Money.SplitMode(rawValue: item.mode))
            let compute = { () throws -> EntryAmounts in
                try Currencies.entryAmounts(
                    amount: item.amount, currency: item.currency, home: item.home, rate: item.rate, mode: mode,
                    split: item.split)
            }
            if let expected = item.expected {
                let amounts = try compute()
                #expect(
                    amounts
                        == EntryAmounts(
                            originalAmount: expected.originalAmount, total: expected.total, share: expected.share),
                    "\(item.amount) \(item.currency) \(item.mode) \(item.split)")
            } else {
                #expect(message { _ = try compute() } == item.error, "\(item.amount) \(item.currency) \(item.mode)")
            }
        }
    }

    @Test("whenGoldenReconversionCase_Reconvert_ShouldConvertAgainAndKeepTheSplit")
    func reconversions() throws {
        func entry(_ wire: CurrencyFixture.ReconvertedEntry) throws -> LedgerEntry {
            LedgerEntry(
                id: "e", title: "Entry", kind: try ContractLedger.kind(wire.kind), total: wire.total, share: wire.share,
                participants: wire.participants, categoryId: "food", date: .day("2026-11-09"),
                originalAmount: wire.originalAmount, originalCurrency: wire.originalCurrency, rate: wire.rate,
                rateStatus: try wire.rateStatus.map { try #require(RateStatus(rawValue: $0)) },
                rateDate: try wire.rateDate.map(ContractLedger.date))
        }
        for item in try load().reconversions {
            let next = RateChoice(
                rate: item.next.rate, status: try #require(RateStatus(rawValue: item.next.rateStatus)),
                date: try item.next.rateDate.map(ContractLedger.date))
            #expect(
                Currencies.reconvert(try entry(item.entry), home: item.home, next: next) == (try entry(item.expected)),
                "\(item.entry) → \(item.next)")
        }
    }

    @Test("whenGoldenLedgerCase_Violations_ShouldAcceptOnlyTheValidLedgers")
    func ledgers() throws {
        for item in try load().ledgers {
            #expect(valid(item.ledger) == item.valid, "\(item.name)")
        }
    }

    @Test("whenEntryIsForeign_ForeignAmountProblem_ShouldNameTheReason")
    func problems() {
        let good = LedgerEntry(
            id: "t", title: "Cooking class", kind: .expense, total: 12_420, share: 12_420, categoryId: "food",
            date: .day("2026-11-03"), originalAmount: 8_500, originalCurrency: "EUR", rate: "1.4612",
            rateStatus: .published, rateDate: .day("2026-11-03"))
        #expect(Currencies.foreignAmountProblem(good, home: "CAD") == nil)
        var entry = good
        entry.total = 12_421
        #expect(Currencies.foreignAmountProblem(entry, home: "CAD") == "Invalid converted amount")
        entry = good
        entry.originalCurrency = "CAD"
        #expect(Currencies.foreignAmountProblem(entry, home: "CAD") == "Invalid original currency")
        entry = good
        entry.rateStatus = .edited
        #expect(Currencies.foreignAmountProblem(entry, home: "CAD") == "Invalid exchange rate")
        entry = good
        entry.rate = nil
        #expect(Currencies.foreignAmountProblem(entry, home: "CAD") == "Invalid original amount")
    }

    /// Whether the write schema accepts `wire`: the domain types refuse what they can't hold (a home
    /// currency outside the list, an unknown rate status, a rule in another currency), and
    /// `violations` the rest.
    private func valid(_ wire: PennyContracts.Ledger) -> Bool {
        guard Currency(rawValue: wire.currency) != nil,
            wire.transactions.allSatisfy({ $0.rateStatus.map { RateStatus(rawValue: $0) != nil } ?? true }),
            wire.recurring.allSatisfy({
                $0.originalAmount == nil && $0.originalCurrency == nil && $0.rate == nil && $0.rateStatus == nil
                    && $0.rateDate == nil
            }),
            let ledger = try? ContractLedger.ledger(wire)
        else { return false }
        return ledger.violations.isEmpty
    }
}
