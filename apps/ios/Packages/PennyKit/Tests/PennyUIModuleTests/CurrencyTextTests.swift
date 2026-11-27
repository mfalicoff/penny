import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyUI

/// How amounts in other currencies and their rates read (MAZ-151).
@Suite("Currency text")
struct CurrencyTextTests {
    private let canada = Locale(identifier: "en_CA")
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    @Test("whenAForeignCurrencySharesTheHomeSymbol_CurrencyText_ShouldPrefixIt")
    func symbols() {
        #expect(CurrencyText.amount(4_800, code: "EUR", home: "CAD", locale: canada) == "€48.00")
        #expect(CurrencyText.amount(3_499, code: "USD", home: "CAD", locale: canada) == "US$34.99")
        #expect(CurrencyText.amount(13_700, code: "JPY", home: "CAD", locale: canada).hasSuffix("13,700"))
        #expect(CurrencyText.symbol("CAD", home: "CAD", locale: canada) == "$")
        #expect(CurrencyText.signed(8_500, code: "EUR", home: "CAD", kind: .expense, locale: canada) == "−€85.00")
    }

    @Test("whenARateIsShown_CurrencyText_ShouldUseAtLeastFourDecimals")
    func rates() {
        #expect(CurrencyText.rate("1.463") == "1.4630")
        #expect(CurrencyText.rate("1") == "1.0000")
        #expect(CurrencyText.rate("0.00906283") == "0.00906283")
        #expect(CurrencyText.rateLine("EUR", rate: "1.4612", home: "CAD") == "1 EUR = 1.4612 CAD")
        #expect(CurrencyText.used(1) == "Used once")
        #expect(CurrencyText.used(3) == "Used 3 times")
    }

    @Test("whenTheRateIsProvisional_CurrencyText_ShouldSayWhichDaysRateIsUsed")
    func provisional() {
        let friday = CalendarDate(year: 2026, month: 11, day: 6)
        #expect(
            CurrencyText.provisionalNote(entryDate: today, rateDate: friday, today: today)
                == "Today's rate isn't out yet, so Penny uses Friday's. It's updated on the next sync, unless you change it."
        )
    }

    @Test("whenTheRatesAreOff_CurrencySettings_ShouldListTheLastRatesUsed")
    func lastRates() {
        func entry(_ id: String, _ code: String, _ rate: String) -> LedgerEntry {
            LedgerEntry(
                id: id, title: id, kind: .expense, total: 100, share: 100, categoryId: "food", date: today,
                originalAmount: 100, originalCurrency: code, rate: rate, rateStatus: .edited)
        }
        let usage = CurrencyUsage(Ledger(transactions: [entry("a", "EUR", "1.46"), entry("b", "USD", "1.37")]))
        #expect(CurrencySettingsView.lastRates(usage) == "EUR 1.4600 · USD 1.3700")
        #expect(CurrencySettingsView.lastRates(CurrencyUsage(Ledger())) == "None yet")
        #expect(CurrencySettingsView.lockedFooter(.cad).contains("Canadian dollars"))
    }
}
