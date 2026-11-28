import Foundation
import PennyDesign
import PennyDomain

/// How amounts in other currencies and their rates read (MAZ-151): "€48.00", "¥13,700", "US$34.99"
/// (a currency written with the home currency's symbol takes its prefix), "1 EUR = 1.4612 CAD",
/// "European Central Bank · Nov 3". Pure, so the wording is tested without a view.
enum CurrencyText {
    /// The currency's symbol in `locale`, prefixed when it would read as the home currency's
    /// ("US$" next to Canadian dollars written "$").
    static func symbol(_ code: String, home: String, locale: Locale = .current) -> String {
        let own = plainSymbol(code, locale: locale)
        guard code != home, own == plainSymbol(home, locale: locale) else { return own }
        return String(code.prefix(2)) + own
    }

    /// The picker's symbol (`iphone-currency-picker`): the narrow one ("¥" for yen, "€"), prefixed
    /// when it would read as the home currency's ("US$" next to Canadian dollars).
    static func pickerSymbol(_ code: String, home: String, locale: Locale = .current) -> String {
        let own = narrowSymbol(code, locale: locale)
        guard code != home, own == narrowSymbol(home, locale: locale) else { return own }
        return String(code.prefix(2)) + own
    }

    private static func narrowSymbol(_ code: String, locale: Locale) -> String {
        let text = Decimal(0).formatted(
            .currency(code: code).presentation(.narrow).locale(locale).precision(.fractionLength(0)))
        let symbol = text.filter { !$0.isNumber && !$0.isWhitespace }
        return symbol.isEmpty ? code : symbol
    }

    private static func plainSymbol(_ code: String, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        return formatter.currencySymbol ?? code
    }

    /// `minor` units of `code`, without a sign, with the currency's own decimals: "€48.00".
    static func amount(_ minor: Int64, code: String, home: String, locale: Locale = .current) -> String {
        let units = Currencies.info(code)?.minorUnits ?? 2
        var scale = Decimal(1)
        for _ in 0..<units { scale *= 10 }
        let value = Decimal(minor.magnitude) / scale
        let text = value.formatted(.currency(code: code).locale(locale).precision(.fractionLength(units)))
        let plain = plainSymbol(code, locale: locale)
        let wanted = symbol(code, home: home, locale: locale)
        guard wanted != plain, let range = text.range(of: plain) else { return text }
        return text.replacingCharacters(in: range, with: wanted)
    }

    /// The amount with an expense's minus (U+2212) or income's plus.
    static func signed(_ minor: Int64, code: String, home: String, kind: EntryKind, locale: Locale = .current)
        -> String
    {
        let text = amount(minor, code: code, home: home, locale: locale)
        switch kind {
        case .expense: return MoneyFormat.minus + text
        case .income: return "+" + text
        case .investment: return text
        }
    }

    /// A rate as the cards show it, with at least four decimals: "1.4630", "0.00906283".
    static func rate(_ rate: String) -> String {
        let parts = rate.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let whole = parts.first.map(String.init) ?? rate
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        return whole + "." + fraction + String(repeating: "0", count: max(0, 4 - fraction.count))
    }

    /// "1 EUR = 1.4612 CAD".
    static func rateLine(_ code: String, rate: String, home: String) -> String {
        "1 \(code) = \(Self.rate(rate)) \(home)"
    }

    /// "Nov 3".
    static func day(_ date: CalendarDate) -> String {
        DayText.date(date).formatted(.dateTime.month(.abbreviated).day())
    }

    /// "Tue, Nov 3".
    static func mediumDay(_ date: CalendarDate) -> String {
        DayText.date(date).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// "Friday".
    static func weekday(_ date: CalendarDate) -> String {
        DayText.date(date).formatted(.dateTime.weekday(.wide))
    }

    /// The source line under a published rate: "European Central Bank · Nov 3".
    static func source(_ source: String?, date: CalendarDate?) -> String {
        [source ?? "Published rate", date.map(day)].compactMap(\.self).joined(separator: " · ")
    }

    /// The note under a provisional rate: "Today's rate isn't out yet, so Penny uses Friday's. It's
    /// updated on the next sync, unless you change it."
    static func provisionalNote(entryDate: CalendarDate, rateDate: CalendarDate?, today: CalendarDate) -> String {
        let day = entryDate == today ? "Today's" : "The \(Self.day(entryDate))"
        let used = rateDate.map { "\(weekday($0))'s" } ?? "the latest one"
        return "\(day) rate isn't out yet, so Penny uses \(used). It's updated on the next sync, unless you change it."
    }

    static let ratesOffNote =
        "Your server doesn't fetch exchange rates. Enter the rate you got, or tap to use the last one."
    static let noRateNote = "Penny has no rate for this currency right now. Enter the rate you got."

    /// The entry detail's footnote: "Your totals use $124.20. To use your card's rate instead, edit
    /// the entry and change its rate."
    static func detailNote(total: Int64, home: String) -> String {
        "Your totals use \(MoneyFormat.amount(total, currency: home)). To use your card's rate instead, "
            + "edit the entry and change its rate."
    }

    /// "Used once", "Used 3 times".
    static func used(_ count: Int) -> String { count == 1 ? "Used once" : "Used \(count) times" }
}
