import Foundation
import PennyAccessibility
import XCTest

private typealias Currencies = AccessibilityID.Currencies

/// The MAZ-270 cards of entries in several currencies (MAZ-151, phase 1), captured with the other
/// cards (`CardCaptureTests`, Cards plan). The test stack runs with reference rate fetching off
/// (`ExchangeRates__Enabled=false`), so every capture shows a server without rates: rates are typed,
/// and Settings › Currency reads "Turned off on this server". The entries in euros, US dollars and
/// yen are written through the real `PUT /api/ledger` before each capture (`seedCurrencies`).
extension CardCaptureTests {
    // MARK: iPhone

    @MainActor
    func test_whenSeeded_IphoneEntryCurrency_ShouldBeCaptured() async throws {
        try await card(
            "iphone-entry-currency", freshSeedPerAppearance: true,
            note: "Rates are off on the test stack, so the rate is typed (Edited) instead of the ECB's"
        ) { card in
            try await card.seedCurrencies()
            try card.draftEuros(rate: "1.4612")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCurrencyPicker_ShouldBeCaptured() async throws {
        try await card("iphone-currency-picker", freshSeedPerAppearance: true) { card in
            try await card.seedCurrencies()
            try card.draftEuros(rate: nil)
            try card.penny.openCurrencyPicker()
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryRateProvisional_ShouldBeRecorded() async throws {
        try blocked(
            "iphone-entry-rate-provisional",
            note:
                "The test stack doesn't fetch rates (ExchangeRates__Enabled=false), so no provisional rate can be "
                + "drawn; the Provisional tag and note are unit-tested (EntryCurrencyTests, ExchangeRateTests)")
    }

    @MainActor
    func test_whenSeeded_IphoneEntryRateEdited_ShouldBeCaptured() async throws {
        try await card(
            "iphone-entry-rate-edited", freshSeedPerAppearance: true,
            note: "No published rate on the test stack: the sheet offers the last rate used instead"
        ) { card in
            try await card.seedCurrencies()
            try card.draftEuros(rate: "1.4612")
            try card.penny.tap(Currencies.rate)
            try card.penny.wait(for: Currencies.Screen.exchangeRate)
            let field = try card.penny.wait(for: Currencies.rateField)
            try card.penny.focus(field, id: Currencies.rateField)
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "1.4900")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryRateManual_ShouldBeCaptured() async throws {
        try await card("iphone-entry-rate-manual", freshSeedPerAppearance: true) { card in
            try await card.seedCurrencies()
            try card.draftEuros(rate: nil)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHomeCurrencies_ShouldBeCaptured() async throws {
        try await card("iphone-home-currencies") { card in
            try await card.seedCurrencies()
            try card.penny.waitForEntry("c-museum")
            try card.penny.reveal("home.recent", above: card.app.frame.height - 120, partly: true)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneActivityCurrencies_ShouldBeCaptured() async throws {
        try await card("iphone-activity-currencies") { card in
            try await card.seedCurrencies()
            try card.penny.openActivity()
            try card.penny.waitForEntry("c-museum")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryDetailCurrency_ShouldBeCaptured() async throws {
        try await card("iphone-entry-detail-currency") { card in
            try await card.seedCurrencies()
            try card.penny.openActivity()
            try card.penny.openEntry("c-cooking")
            try card.penny.wait(for: Currencies.detailRate)
            // The note above the floating tab bar, as on the card.
            try card.penny.reveal(Currencies.detailNote, above: card.app.frame.height - 130, partly: true)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCurrencyRates_ShouldBeCaptured() async throws {
        try await card(
            "iphone-currency-rates",
            note: "Rates are off on the test stack: Daily rates reads Off, as on the rates-off card"
        ) { card in
            try await card.seedCurrencies()
            try card.openCurrencySettings()
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCurrencyRatesOff_ShouldBeCaptured() async throws {
        try await card("iphone-currency-rates-off") { card in
            try await card.seedCurrencies()
            try card.openCurrencySettings()
        }
    }

    // MARK: iPad

    @MainActor
    func test_whenSeeded_IpadAddEntryCurrency_ShouldBeCaptured() async throws {
        try await card(
            "ipad-add-entry-currency", freshSeedPerAppearance: true,
            note: "Rates are off on the test stack, so the rate is typed (Edited) instead of the ECB's"
        ) { card in
            try await card.seedCurrencies()
            try card.draftEuros(rate: "1.4612")
        }
    }

    @MainActor
    func test_whenSeeded_IpadActivityCurrencies_ShouldBeCaptured() async throws {
        try await card("ipad-activity-currencies") { card in
            try await card.seedCurrencies()
            try card.penny.openActivity()
            try card.penny.openEntry("c-cooking")
            try card.penny.wait(for: Currencies.detailRate)
        }
    }

    @MainActor
    func test_whenSeeded_IpadSettingsCurrency_ShouldBeCaptured() async throws {
        try await card(
            "ipad-settings-currency", note: "Rates are off on the test stack: Daily rates reads Off"
        ) { card in
            try await card.seedCurrencies()
            try card.openCurrencySettings()
        }
    }
}

@MainActor
extension CardContext {
    /// Alex's entries in other currencies (home CAD), each total the conversion of its amount:
    /// a cooking class and museum passes in euros (the passes on a provisional rate), an order in
    /// US dollars, ramen in yen, and tapas in euros at the last rate used (1.46).
    static let currencyEntries: [[String: Any]] = [
        entry(
            "c-cooking", "Cooking class", "fun", "2026-10-12", total: 12420, amount: 8500, code: "EUR",
            rate: "1.4612", status: "published", rateDate: "2026-10-12", note: "Pastéis de nata, Alfama"),
        entry(
            "c-ramen", "Ramen", "food", "2026-10-02", total: 1088, amount: 1200, code: "JPY", rate: "0.00906283",
            status: "edited"),
        entry(
            "c-amazon", "Amazon.com order", "home", "2026-10-13", total: 4794, amount: 3499, code: "USD", rate: "1.37",
            status: "edited"),
        entry(
            "c-museum", "Museum passes", "fun", "2026-10-15", total: 7022, amount: 4800, code: "EUR", rate: "1.463",
            status: "provisional", rateDate: "2026-10-14"),
        entry(
            "c-tapas", "Tapas", "food", "2026-10-15", total: 2920, amount: 2000, code: "EUR", rate: "1.46",
            status: "edited"),
    ]

    static func entry(
        _ id: String, _ title: String, _ category: String, _ date: String, total: Int, amount: Int, code: String,
        rate: String, status: String, rateDate: String? = nil, note: String = ""
    ) -> [String: Any] {
        var value: [String: Any] = [
            "id": id, "title": title, "kind": "expense", "total": total, "share": total, "categoryId": category,
            "accountId": "card", "date": date, "note": note, "originalAmount": amount, "originalCurrency": code,
            "rate": rate, "rateStatus": status,
        ]
        if let rateDate { value["rateDate"] = rateDate }
        return value
    }

    /// Writes `currencyEntries` to the card's account as another device would, once, then waits for
    /// the app to show them (Activity's sync on refresh).
    func seedCurrencies() async throws {
        let token = try seeded().user(state.alias ?? "alex").token
        let current = try await stack.ledger(token: token)
        if LedgerJSON.transaction(current.ledger, id: "c-cooking") == nil {
            try await stack.updateLedger(token: token) { ledger in
                var list = ledger["transactions"] as? [[String: Any]] ?? []
                list.append(contentsOf: Self.currencyEntries)
                ledger["transactions"] = list
            }
        }
        // The app syncs when it becomes active: out to the Home Screen and back.
        XCUIDevice.shared.press(.home)
        app.activate()
        try penny.waitForShell()
    }

    /// Add entry with €85.00 for a cooking class, in euros, with `rate` typed in the Exchange rate
    /// sheet (nil leaves the rate to enter).
    func draftEuros(rate: String?) throws {
        try penny.openAddEntry()
        try penny.enterAmount("85.00")
        // Return ends the name (the form keeps the expense type and the keypad).
        try penny.type("Cooking class\n", into: AccessibilityID.EntryForm.title)
        try penny.openCurrencyPicker()
        let search = app.searchFields.firstMatch
        guard search.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "The currency picker has no search field")
        }
        search.tap()
        search.typeText("Euro")
        try penny.tap(Currencies.option("EUR"))
        try penny.waitForAbsence(of: Currencies.Screen.picker)
        try penny.wait(for: Currencies.rate)
        guard let rate else { return }
        try penny.tap(Currencies.rate)
        try penny.wait(for: Currencies.Screen.exchangeRate)
        try penny.type(rate, into: Currencies.rateField)
        try penny.tap(Currencies.rateDone)
        try penny.waitForAbsence(of: Currencies.Screen.exchangeRate)
    }

    func openCurrencySettings() throws {
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        try penny.wait(for: Currencies.dailyRates)
        try penny.wait(for: Currencies.recent("EUR"), timeout: 30)
    }
}

@MainActor
extension Penny {
    /// The entry form's currency chip, tapped again when a tap lands while the keyboard leaves.
    func openCurrencyPicker() throws {
        let chip = try wait(for: Currencies.chip)
        for _ in 0..<3 {
            chip.tap()
            if element(Currencies.Screen.picker).waitForExistence(timeout: 8) { return }
        }
        throw UIExpectationFailed(description: "The currency chip did not open the picker")
    }
}
