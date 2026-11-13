public import Foundation
public import SwiftUI

/// What an amount means, which decides its sign and color (design-kit `Money`): expenses use
/// the label color with a minus sign, never red; income is green with a plus sign;
/// investments are indigo and unsigned; pending (expected or waiting) is amber.
nonisolated public enum MoneyMeaning: Sendable {
    case expense, income, investment, pending, neutral
}

/// Formats integer cents. Pure, so the rules are tested without a view.
nonisolated public enum MoneyFormat {
    /// The typographic minus the design uses (U+2212), not a hyphen.
    public static let minus = "\u{2212}"

    /// `cents` in `currency` (ISO code), without a sign: "$48.90".
    public static func amount(_ cents: Int64, currency: String, locale: Locale = .current) -> String {
        let value = Decimal(cents.magnitude) / 100
        return value.formatted(.currency(code: currency).locale(locale).precision(.fractionLength(2)))
    }

    /// The amount with the sign its meaning takes: "−$48.90", "+$3,200.00", "$200.00".
    /// A negative `cents` with `.neutral` (a signed total such as Left to spend) keeps its minus.
    public static func signed(
        _ cents: Int64, meaning: MoneyMeaning, currency: String, locale: Locale = .current
    ) -> String {
        let text = amount(cents, currency: currency, locale: locale)
        switch meaning {
        case .expense: return cents == 0 ? text : minus + text
        case .income: return cents == 0 ? text : "+" + text
        case .investment, .pending: return text
        case .neutral: return cents < 0 ? minus + text : text
        }
    }

    /// What VoiceOver reads: the amount and its meaning in words, never a symbol.
    public static func spoken(
        _ cents: Int64, meaning: MoneyMeaning, currency: String, locale: Locale = .current
    ) -> String {
        let text = amount(cents, currency: currency, locale: locale)
        switch meaning {
        case .expense: return "\(text) spent"
        case .income: return "\(text) received"
        case .investment: return "\(text) invested"
        case .pending: return "\(text) expected"
        case .neutral: return cents < 0 ? "minus \(text)" : text
        }
    }

    /// Splits "$1,116.65" into "$1,116" and ".65" so the hero can draw the cents smaller.
    public static func heroParts(_ text: String, locale: Locale = .current) -> (whole: String, fraction: String) {
        let separator = locale.decimalSeparator ?? "."
        guard let range = text.range(of: separator, options: .backwards) else { return (text, "") }
        return (String(text[..<range.lowerBound]), String(text[range.lowerBound...]))
    }
}

extension MoneyMeaning {
    public var color: Color {
        switch self {
        case .expense, .neutral: PennyColor.label
        case .income: PennyColor.income
        case .investment: PennyColor.invest
        case .pending: PennyColor.pending
        }
    }
}

/// An amount in a row or a total: tabular digits so columns line up, the meaning's color and
/// sign, and a spoken label.
public struct MoneyText: View {
    private let cents: Int64
    private let meaning: MoneyMeaning
    private let currency: String
    private let style: Font

    public init(_ cents: Int64, meaning: MoneyMeaning, currency: String, style: Font = .body.weight(.semibold)) {
        self.cents = cents
        self.meaning = meaning
        self.currency = currency
        self.style = style
    }

    public var body: some View {
        Text(MoneyFormat.signed(cents, meaning: meaning, currency: currency))
            .font(style.monospacedDigit())
            .foregroundStyle(meaning.color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityLabel(MoneyFormat.spoken(cents, meaning: meaning, currency: currency))
    }
}

/// The one big number that leads a screen (Home's **Left to spend**). The cents are smaller
/// and muted. It scales with Dynamic Type and never truncates; it shrinks to fit instead.
public struct HeroAmount<Detail: View>: View {
    private let label: String
    private let cents: Int64
    private let currency: String
    private let tone: MoneyMeaning
    private let detail: Detail

    public init(
        _ label: String, cents: Int64, currency: String, tone: MoneyMeaning = .neutral,
        @ViewBuilder detail: () -> Detail
    ) {
        self.label = label
        self.cents = cents
        self.currency = currency
        self.tone = tone
        self.detail = detail()
    }

    public var body: some View {
        let text = MoneyFormat.signed(cents, meaning: .neutral, currency: currency)
        let parts = MoneyFormat.heroParts(text)
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(PennyFont.style(.footnote))
                .foregroundStyle(PennyColor.secondaryLabel)
            let whole = Text(parts.whole).foregroundStyle(tone.color)
            let fraction = Text(parts.fraction).foregroundStyle(PennyColor.secondaryLabel).font(.title.weight(.bold))
            Text("\(whole)\(fraction)")
                .modifier(HeroAmountFont())
                .lineLimit(1)
                .minimumScaleFactor(0.4)
            detail
                .font(PennyFont.style(.subhead))
                .foregroundStyle(PennyColor.secondaryLabel)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), \(MoneyFormat.spoken(cents, meaning: .neutral, currency: currency))")
    }
}

extension HeroAmount where Detail == EmptyView {
    public init(_ label: String, cents: Int64, currency: String, tone: MoneyMeaning = .neutral) {
        self.init(label, cents: cents, currency: currency, tone: tone) { EmptyView() }
    }
}
