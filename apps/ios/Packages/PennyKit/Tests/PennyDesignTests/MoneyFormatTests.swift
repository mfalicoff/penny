import Foundation
import PennyDesign
import Testing

@Suite("Money formatting")
struct MoneyFormatTests {
    private let locale = Locale(identifier: "en_CA")

    @Test("whenFormattedByMeaning_MoneyFormat_ShouldSignExpensesWithMinusAndIncomeWithPlus")
    func signs() {
        #expect(MoneyFormat.signed(4_890, meaning: .expense, currency: "CAD", locale: locale) == "−$48.90")
        #expect(MoneyFormat.signed(320_000, meaning: .income, currency: "CAD", locale: locale) == "+$3,200.00")
        #expect(MoneyFormat.signed(20_000, meaning: .investment, currency: "CAD", locale: locale) == "$200.00")
        #expect(MoneyFormat.signed(-1_250, meaning: .neutral, currency: "CAD", locale: locale) == "−$12.50")
        #expect(MoneyFormat.signed(0, meaning: .expense, currency: "CAD", locale: locale) == "$0.00")
        #expect(MoneyFormat.minus == "\u{2212}", "a typographic minus, not a hyphen")
    }

    @Test("whenReadByVoiceOver_MoneyFormat_ShouldSayTheMeaningInWords")
    func spoken() {
        #expect(MoneyFormat.spoken(4_890, meaning: .expense, currency: "CAD", locale: locale) == "$48.90 spent")
        #expect(MoneyFormat.spoken(100, meaning: .income, currency: "CAD", locale: locale) == "$1.00 received")
        #expect(MoneyFormat.spoken(-100, meaning: .neutral, currency: "CAD", locale: locale) == "minus $1.00")
    }

    @Test("whenTheKeypadDraftIsShown_MoneyFormat_ShouldGroupItByLocaleAndKeepTheFractionAsTyped")
    func typed() {
        #expect(MoneyFormat.typed("3200.00", locale: locale) == "3,200.00")
        #expect(MoneyFormat.typed("1234567", locale: locale) == "1,234,567")
        #expect(MoneyFormat.typed("3200.", locale: locale) == "3,200.")
        #expect(MoneyFormat.typed("3200.5", locale: locale) == "3,200.5")
        #expect(MoneyFormat.typed("999", locale: locale) == "999")
        #expect(MoneyFormat.typed("0.5", locale: locale) == "0.5")
        let french = MoneyFormat.typed("3200.5", locale: Locale(identifier: "fr_CA"))
        #expect(french.hasSuffix(",5") && french.hasPrefix("3") && french.count == 7, "\(french)")
        #expect(MoneyFormat.typed("100000", locale: Locale(identifier: "en_IN")) == "1,00,000")
    }

    @Test("whenTheDraftIsNotANumber_MoneyFormat_ShouldLeaveItUnchanged")
    func typedUnchanged() {
        #expect(MoneyFormat.typed("", locale: locale) == "")
        #expect(MoneyFormat.typed(".5", locale: locale) == ".5")
        #expect(MoneyFormat.typed("12a", locale: locale) == "12a")
        #expect(MoneyFormat.typed("1.2.3", locale: locale) == "1.2.3")
    }

    @Test("whenShownAsTheHero_MoneyFormat_ShouldSplitOffTheCents")
    func hero() {
        let text = MoneyFormat.signed(111_665, meaning: .neutral, currency: "CAD", locale: locale)
        let parts = MoneyFormat.heroParts(text, locale: locale)
        #expect(parts.whole == "$1,116" && parts.fraction == ".65")
        let french = Locale(identifier: "fr_CA")
        let frenchParts = MoneyFormat.heroParts(
            MoneyFormat.signed(111_665, meaning: .neutral, currency: "CAD", locale: french), locale: french)
        #expect(frenchParts.fraction.hasPrefix(","))
    }

    @Test("whenTheStoredIconAndCategoryAreMapped_CategoryStyle_ShouldUseSFSymbolsAndThePalette")
    func categories() {
        #expect(CategoryStyle.symbol(forIonicon: "basket-outline") == "basket")
        #expect(CategoryStyle.symbol(forIonicon: "not-an-icon") == "tag")
        #expect(CategoryStyle.color(forCategoryID: "fun") == .entertainment)
        #expect(CategoryStyle.color(forCategoryID: "salary") == .other)
    }

    @Test("whenControlsAreSized_ControlSize_ShouldNeverGoBelowTheMinimumTouchTarget")
    func targets() {
        for size in [ControlSize.button, ControlSize.glassButton, ControlSize.floatingButton, ControlSize.row] {
            #expect(size >= Metrics.minTouchTarget)
        }
    }
}
