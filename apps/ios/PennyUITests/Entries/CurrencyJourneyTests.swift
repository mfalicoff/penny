import PennyAccessibility
import XCTest

private typealias Currencies = AccessibilityID.Currencies

/// Entries in several currencies (MAZ-151) end to end, against the real API. The test stack runs
/// with reference rate fetching off (`ExchangeRates__Enabled=false`), as a server whose operator
/// turned it off: the form asks for a rate, refuses to save without one, and stores the amount
/// paid, the typed (edited) rate and the converted home total, which Activity, the entry detail
/// and Settings › Currency then show.
final class CurrencyJourneyTests: PennyUITestCase {
    @MainActor
    func test_whenAnExpenseIsPaidInEurosOnAServerWithoutRates_EntryForm_ShouldNeedARateAndKeepBothAmounts()
        async throws
    {
        let stack = try await stack()
        let account = try await makeAccount("currencies")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)

        // A new expense, moved to euros in the currency picker (searched by name).
        let title = "Cooking class \(Device.name)"
        try penny.openAddEntry()
        try penny.enterAmount("85.00")
        try penny.openCurrencyPicker()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: Penny.timeout))
        search.tap()
        search.typeText("Euro")
        try penny.tap(Currencies.option("EUR"))
        try penny.waitForAbsence(of: Currencies.Screen.picker)
        try penny.wait(for: Currencies.rate)
        // Return ends the name.
        try penny.type(title + "\n", into: AccessibilityID.EntryForm.title)

        // Rates are off on this server: no rate, so Save is refused and the form stays open.
        try penny.tap(AccessibilityID.EntryForm.save)
        try penny.wait(for: "banner.saveError")
        XCTAssertTrue(penny.element(AccessibilityID.Screen.addEntry).exists)
        screenshot("entry-currency-rate-needed")

        // Type the rate from the card statement.
        try penny.tap(Currencies.rate)
        try penny.wait(for: Currencies.Screen.exchangeRate)
        try penny.type("1.4612", into: Currencies.rateField)
        let converted = try penny.wait(for: Currencies.rateConverted)
        XCTAssertTrue(converted.label.contains("124.20"), converted.label)
        try penny.tap(Currencies.rateDone)
        try penny.waitForAbsence(of: Currencies.Screen.exchangeRate)
        let line = try penny.wait(for: Currencies.converted)
        XCTAssertTrue(line.label.contains("124.20"), line.label)
        screenshot("entry-currency-rate-typed")
        try penny.saveEntryForm()

        // The server stores the amount paid, the edited rate and the converted home total.
        let ledger = try await stack.waitForLedger(token: account.token, timeout: 30) { ledger in
            LedgerJSON.transaction(ledger, title: title) != nil
        }
        let entry = try XCTUnwrap(LedgerJSON.transaction(ledger, title: title))
        let id = try XCTUnwrap(entry["id"] as? String)
        XCTAssertEqual(entry["kind"] as? String, "expense")
        XCTAssertEqual(entry["total"] as? Int, 12420)
        XCTAssertEqual(entry["share"] as? Int, 12420)
        XCTAssertEqual(entry["originalAmount"] as? Int, 8500)
        XCTAssertEqual(entry["originalCurrency"] as? String, "EUR")
        XCTAssertEqual(entry["rate"] as? String, "1.4612")
        XCTAssertEqual(entry["rateStatus"] as? String, "edited")
        XCTAssertNil(entry["rateDate"])

        // Activity leads with the home amount and shows the euros under it.
        try penny.openActivity()
        let row = try penny.waitForEntry(id)
        XCTAssertTrue(row.label.contains("85.00") && row.label.contains("124.20"), row.label)
        screenshot("activity-currencies")

        // The detail shows the rate it was converted at.
        try penny.openEntry(id)
        let rate = try penny.wait(for: Currencies.detailRate)
        XCTAssertTrue(rate.label.contains("1.4612"), rate.label)
        screenshot("entry-detail-currency")

        // Settings › Currency: rates are off on this server, and euros were used once.
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        let daily = try penny.wait(for: Currencies.dailyRates)
        XCTAssertTrue(daily.label.contains("Off"), daily.label)
        let recent = try penny.wait(for: Currencies.recent("EUR"))
        XCTAssertTrue(recent.label.contains("Used once"), recent.label)
        screenshot("currency-rates-off")
    }
}
