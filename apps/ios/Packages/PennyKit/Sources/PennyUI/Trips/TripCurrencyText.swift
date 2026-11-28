import Foundation
import PennyDesign
import PennyDomain

/// Words for shared trips and households in several currencies (MAZ-151 phase 2; cards
/// `iphone-trip-form-currency`, `iphone-trip-currencies`, `ipad-trip-currencies`,
/// `iphone-trip-balances-currency`). Pure, so the wording is tested without a view.
enum TripCurrencyText {
    /// A currency's name in the plural, lower case where the language does ("euros", "US dollars",
    /// "Canadian dollars"), from the locale's plural currency format; the code when it has none.
    static func plural(_ code: String, locale: Locale = Locale(identifier: "en_US")) -> String {
        let text = Decimal(2).formatted(
            .currency(code: code).presentation(.fullName).locale(locale).precision(.fractionLength(0)))
        // "2 euros" → "euros".
        let words = text.split(separator: " ", maxSplits: 1).map(String.init)
        guard words.count == 2, words[0].contains("2") else { return code }
        return words[1]
    }

    /// "EUR, USD and CAD" (no serial comma, as the cards write it).
    static func list(_ codes: [String]) -> String {
        guard let last = codes.last else { return "" }
        guard codes.count > 1 else { return last }
        return codes.dropLast().joined(separator: ", ") + " and " + last
    }

    /// The trip's chip: "EUR, USD and CAD · each at its date's rate".
    static func chip(_ codes: [String]) -> String { "\(list(codes)) · each at its date's rate" }

    /// `iphone-trip-form-currency`'s note under When: where new expenses start, where payments are
    /// suggested (a shared trip), and the dates.
    static func formNote(_ code: String, shared: Bool) -> String {
        let name = plural(code)
        let start =
            shared
            ? "New trip expenses start in \(name), and payments are suggested in \(name)."
            : "New trip expenses start in \(name)."
        return "\(start) Any expense can use another currency. "
            + "Expenses can be dated outside the trip — flights booked in October still count."
    }

    /// "Balances in euros".
    static func balancesTitle(_ code: String) -> String { "Balances in \(plural(code))" }

    /// "Settle in EUR".
    static func settleIn(_ code: String) -> String { "Settle in \(code)" }

    /// `iphone-trip-balances-currency`'s note under the suggested payments.
    static func balancesNote(_ code: String) -> String {
        "Each expense counts in \(plural(code)) at its own date's rate, so balances don't move later. Under a "
            + "balance: that person's own currency, at today's rate."
    }

    /// The same note while the balances show in another currency than the trip's.
    static func settleNote(trip: String, shown: String) -> String {
        "Balances are kept in \(plural(trip)); here they show in \(plural(shown)) at today's rate. Record paid "
            + "records the amount in \(plural(trip))."
    }

    /// "≈ US$349.76": a balance in a member's own currency, at today's rate.
    static func approximately(_ minor: Int64, code: String, home: String) -> String {
        "≈ " + CurrencyText.amount(minor, code: code, home: home)
    }

    /// `ipad-trip-currencies`' Exchange rates panel: "Euro · 2 expenses".
    static func rateDetail(_ code: String, count: Int) -> String {
        "\(Currencies.info(code)?.name ?? code) · \(TripText.expenses(count))"
    }

    /// The Exchange rates panel's note.
    static func ratesNote(home: String, source: String?, provisional: [String]) -> String {
        var text =
            "Totals here are in your currency, \(plural(home)). Rates are \(source.map { "the \($0)'s" } ?? "the published ones") "
            + "for each expense's date."
        if let first = provisional.first {
            text +=
                provisional.count == 1
                ? " \(first) uses the latest rate until its date's is published."
                : " \(list(provisional)) use the latest rate until their dates' are published."
        }
        return text
    }
}

extension TripText {
    /// The trip form's note under When (MAZ-151 phase 2: with the trip's currency).
    static func currencyNote(_ code: String, shared: Bool) -> String {
        TripCurrencyText.formNote(code, shared: shared)
    }
}
