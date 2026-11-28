import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

/// How shared trips in several currencies read (MAZ-151 phase 2).
@Suite("Trip currency text")
struct TripCurrencyTextTests {
    private let canada = Locale(identifier: "en_CA")

    @Test("whenATripHasCurrencies_TripCurrencyText_ShouldReadAsTheCards")
    func wording() {
        #expect(TripCurrencyText.list(["EUR", "USD", "CAD"]) == "EUR, USD and CAD")
        #expect(TripCurrencyText.list(["EUR"]) == "EUR")
        #expect(TripCurrencyText.chip(["EUR", "USD", "CAD"]) == "EUR, USD and CAD · each at its date's rate")
        #expect(TripCurrencyText.plural("EUR") == "euros")
        #expect(TripCurrencyText.plural("USD") == "US dollars")
        #expect(TripCurrencyText.balancesTitle("EUR") == "Balances in euros")
        #expect(TripCurrencyText.settleIn("EUR") == "Settle in EUR")
        #expect(
            TripCurrencyText.balancesNote("EUR")
                == "Each expense counts in euros at its own date's rate, so balances don't move later. Under a "
                + "balance: that person's own currency, at today's rate.")
        #expect(
            TripCurrencyText.formNote("EUR", shared: true)
                == "New trip expenses start in euros, and payments are suggested in euros. Any expense can use "
                + "another currency. Expenses can be dated outside the trip — flights booked in October still count.")
        #expect(TripCurrencyText.formNote("EUR", shared: false).hasPrefix("New trip expenses start in euros. Any"))
        #expect(TripCurrencyText.approximately(34_976, code: "USD", home: "CAD").hasSuffix("US$349.76"))
    }

    @Test("whenACurrencyHasOtherDecimals_MoneyFormat_ShouldMatchTheCurrencyList")
    func minorUnits() {
        for info in Currencies.all {
            #expect(MoneyFormat.minorUnits(info.code) == info.minorUnits, "\(info.code)")
        }
        #expect(MoneyFormat.amount(120_000, currency: "JPY", locale: canada).hasSuffix("120,000"))
        #expect(MoneyFormat.amount(12_345, currency: "KWD", locale: canada).hasSuffix("12.345"))
        #expect(MoneyFormat.amount(4_800, currency: "EUR", locale: canada) == "€48.00")
    }

    @Test("whenATripHasACurrency_CurrencyPicker_ShouldSuggestItFirst")
    func suggested() {
        #expect(CurrencyPickerSheet.suggested(selection: "EUR", home: "CAD", trip: "EUR") == ["EUR", "CAD"])
        #expect(CurrencyPickerSheet.suggested(selection: "USD", home: "CAD", trip: "EUR") == ["EUR", "USD", "CAD"])
        #expect(CurrencyPickerSheet.suggested(selection: "CAD", home: "CAD") == ["CAD"])
    }

    @Test("whenAnExpenseWasPaidInAnotherCurrency_ExpenseDetail_ShouldListTheTripsAndYourAmounts")
    func detailLines() {
        var expense = WireSharedExpense(
            id: "f", householdId: "h", title: "Flights", totalCents: 56_400, date: "2026-10-02", payerUserId: "sam",
            splitMode: "equal", splits: [WireSplit(userId: "me", amountCents: 28_200)],
            category: WireSharedCategory(name: "Travel", icon: "airplane-outline", color: "#5B7DB1"),
            createdBy: "sam", createdAt: 1, updatedBy: "sam", updatedAt: 1)
        expense.originalAmount = 60_000
        expense.originalCurrency = "USD"
        expense.rate = "0.94"
        expense.rateStatus = "published"
        expense.home = WireMemberHomeAmounts(
            currency: "CAD", totalCents: 82_380, shareCents: 41_190, rate: "1.373", rateStatus: "provisional")
        let amounts = expense.amounts(householdCurrency: "EUR", home: "CAD", meId: "me")
        let lines = HouseholdExpenseDetailLines.lines(amounts, householdTotal: 56_400, household: "EUR")
        #expect(lines.map(\.text).count == 2)
        #expect(lines[0].text.hasSuffix("EUR") && !lines[0].provisional)
        #expect(lines[1].text.hasPrefix("≈ ") && lines[1].provisional)
    }
}
