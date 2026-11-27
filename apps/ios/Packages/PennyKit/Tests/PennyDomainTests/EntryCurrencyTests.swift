import PennyDomain
import Testing

/// The entry form's rules for an entry in another currency (MAZ-151).
@Suite("Entry in another currency")
struct EntryCurrencyTests {
    static let categories = Ledger.defaultCategories

    static func draft(
        amount: String = "85.00", currency: String? = "EUR", rate: String? = "1.4612",
        status: RateStatus? = .published, split: Money.SplitMode = .full, share: String = ""
    ) -> EntryDraft {
        EntryDraft(
            kind: .expense, title: "Cooking class", amount: amount, date: "2026-11-03", categoryId: "fun", split: split,
            shareInput: share, frequency: .monthly, currency: currency, rate: rate, rateStatus: status,
            rateDate: status == .edited ? nil : .day("2026-11-03"))
    }

    @Test("whenADraftIsInEuros_Build_ShouldStoreTheOriginalAmountAndTheConvertedTotal")
    func build() throws {
        let (entry, rule) = try Self.draft().build(categories: Self.categories, home: .cad, makeID: { "e" })
        #expect(entry.total == 12_420 && entry.share == 12_420)
        #expect(entry.originalAmount == 8_500 && entry.originalCurrency == "EUR" && entry.rate == "1.4612")
        #expect(entry.rateStatus == .published && entry.rateDate == .day("2026-11-03"))
        // Rules stay in the home currency: a foreign draft never starts one.
        #expect(rule == nil)
        #expect(Currencies.foreignAmountProblem(entry, home: "CAD") == nil)
        let half = try Self.draft(split: .equal, share: "2").build(categories: Self.categories, home: .cad) { "e" }
        #expect(half.entry.share == 6_210 && half.entry.participants == 2)
    }

    @Test("whenThereIsNoRate_Build_ShouldRefuseWithEnterTheExchangeRate")
    func missingRate() {
        #expect(throws: LedgerRuleError.missingRate) {
            try Self.draft(rate: nil, status: nil).build(categories: Self.categories, home: .cad) { "e" }
        }
        #expect(throws: LedgerRuleError.invalidCurrencyAmount(decimals: 0)) {
            try Self.draft(amount: "1200.5", currency: "JPY").build(categories: Self.categories, home: .cad) { "e" }
        }
    }

    @Test("whenTheCurrencyIsHome_Draft_ShouldBuildAPlainEntry")
    func home() throws {
        let entry = try Self.draft(currency: "CAD").build(categories: Self.categories, home: .cad) { "e" }.entry
        #expect(entry.total == 8_500 && entry.originalCurrency == nil && entry.rate == nil)
    }

    @Test("whenTheCurrencyChanges_SetCurrency_ShouldDropExtraDecimalsAndTheRate")
    func setCurrency() {
        var draft = Self.draft(amount: "85.50")
        draft.setCurrency("JPY", home: .cad)
        #expect(draft.amount == "85" && draft.rate == nil && draft.rateStatus == nil)
        draft.setCurrency("CAD", home: .cad)
        #expect(draft.currency == nil)
        #expect(AmountInput.fitting("1.2345", minorUnits: 3) == "1.234")
        #expect(AmountInput.apply(.separator, to: "12", minorUnits: 0) == "12")
        #expect(AmountInput.apply(.digit(5), to: "1.23", minorUnits: 3) == "1.235")
        #expect(AmountInput.text(minor: 1200, minorUnits: 0) == "1200")
        #expect(AmountInput.text(minor: 1234, minorUnits: 3) == "1.234")
    }

    @Test("whenARateIsEdited_ApplyRate_ShouldKeepItOverALookedUpOne")
    func editedWins() {
        var draft = Self.draft()
        draft.applyRate(RateChoice(rate: "1.49", status: .edited))
        draft.applyRate(RateChoice(rate: "1.463", status: .provisional, date: .day("2026-11-06")))
        #expect(draft.rate == "1.49" && draft.rateStatus == .edited && draft.rateDate == nil)
        #expect(draft.convertedTotal(home: .cad) == 12_665)
    }

    @Test("whenAForeignEntryIsEditedElsewhere_Build_ShouldKeepItsStoredAmounts")
    func editKeepsAmounts() throws {
        let entry = LedgerEntry(
            id: "e", title: "Dinner", kind: .expense, total: 12_420, share: 4_000, categoryId: "food",
            date: .day("2026-11-03"), originalAmount: 8_500, originalCurrency: "EUR", rate: "1.4612",
            rateStatus: .published, rateDate: .day("2026-11-03"))
        var draft = EntryDraft(editing: entry)
        #expect(draft.amount == "85.00" && draft.currency == "EUR" && draft.split == .amount)
        draft.title = "Dinner in Alfama"
        let saved = try draft.build(categories: Self.categories, editing: entry, home: .cad) { "x" }.entry
        #expect(saved.share == 4_000 && saved.total == 12_420 && saved.title == "Dinner in Alfama")
        draft.amount = "90.00"
        let changed = try draft.build(categories: Self.categories, editing: entry, home: .cad) { "x" }.entry
        #expect(changed.total == 13_151 && changed.originalAmount == 9_000)
    }
}
