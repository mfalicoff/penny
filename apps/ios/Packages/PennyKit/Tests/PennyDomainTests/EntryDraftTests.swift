import PennyDomain
import Testing

@Suite("Entry drafts")
struct EntryDraftTests {
    static let categories = PennyDomain.Ledger.defaultCategories

    static func ids() -> () -> String {
        var next = 0
        return {
            next += 1
            return "id\(next)"
        }
    }

    @Test("whenSplitExpenseDraft_Build_ShouldTrimAndKeepTotalAndShare")
    func splitExpense() throws {
        let draft = EntryDraft(
            kind: .expense, title: "  Dinner ", amount: "100,01", date: "2026-11-03", categoryId: "food",
            accountId: "visa", tripId: "lisbon", note: " shared \n", split: .equal, shareInput: "3")
        let (entry, rule) = try draft.build(categories: Self.categories, makeID: Self.ids())
        #expect(entry.id == "id1" && entry.title == "Dinner" && entry.note == "shared")
        #expect(entry.total == 10001 && entry.share == 3334)
        #expect(entry.tripId == "lisbon" && entry.accountId == "visa")
        #expect(rule == nil)
    }

    @Test("whenIncomeDraftHasSplitTripAndReceipt_Build_ShouldDropThem")
    func incomeIsFull() throws {
        let receipt = ReceiptReference(id: "rc", name: "r.pdf", uri: "/api/receipts/rc", mime: "application/pdf")
        let draft = EntryDraft(
            kind: .income, title: "Pay", amount: "2250", date: "2026-11-15", categoryId: "salary", tripId: "lisbon",
            split: .percent, shareInput: "10", receipt: receipt)
        let (entry, _) = try draft.build(categories: Self.categories, makeID: Self.ids())
        #expect(entry.share == 225_000 && entry.total == 225_000)
        #expect(entry.tripId == nil && entry.receipt == nil)
    }

    @Test(
        "whenDraftIsInvalid_Build_ShouldRefuseInTheDocumentedOrder",
        arguments: [
            (
                EntryDraft(kind: .expense, title: "", amount: "x", date: "bad", categoryId: "gone"),
                LedgerRuleError.invalidAmount
            ),
            (EntryDraft(kind: .expense, title: "", amount: "0,00", date: "bad", categoryId: "gone"), .zeroAmount),
            (EntryDraft(kind: .expense, title: "", amount: "1", date: "2026-02-30", categoryId: "gone"), .invalidDate),
            (EntryDraft(kind: .expense, title: "", amount: "1", date: "2101-01-01", categoryId: "gone"), .invalidDate),
            (
                EntryDraft(kind: .expense, title: " \u{3000}", amount: "1", date: "2026-01-01", categoryId: "gone"),
                .missingTitle
            ),
            (
                EntryDraft(kind: .expense, title: "a", amount: "1", date: "2026-01-01", categoryId: "gone"),
                .chooseCategory
            ),
            (
                EntryDraft(kind: .income, title: "a", amount: "1", date: "2026-01-01", categoryId: "food"),
                .chooseCategory
            ),
            (
                EntryDraft(
                    kind: .expense, title: "a", amount: "1", date: "2026-01-01", categoryId: "food", split: .amount,
                    shareInput: "1.01"), .shareExceedsTotal
            ),
            (
                EntryDraft(
                    kind: .expense, title: "a", amount: "1", date: "2026-01-01", categoryId: "food", split: .equal,
                    shareInput: "1"), .invalidSplitPeople
            ),
        ])
    func invalidDrafts(draft: EntryDraft, error: LedgerRuleError) {
        #expect(throws: error) { try draft.build(categories: Self.categories, makeID: Self.ids()) }
    }

    @Test("whenNewDraftRepeats_Build_ShouldStartARuleAnchoredOnItsDay")
    func newRepeatingDraft() throws {
        let draft = EntryDraft(
            kind: .investment, title: "ETF", amount: "500", date: "2026-01-31", categoryId: "investments",
            accountId: "visa", frequency: .monthly)
        let (entry, maybeRule) = try draft.build(categories: Self.categories, makeID: Self.ids())
        let rule = try #require(maybeRule)
        #expect(entry.id == "id1" && rule.id == "id2" && entry.recurringId == "id2")
        #expect(rule.date == .day("2026-01-31") && rule.nextDate == .day("2026-02-28") && rule.anchorDay == 31)
        #expect(rule.active && rule.accountId == "visa" && rule.share == 50_000)
        // Saving then materializing never records the first date twice.
        let ledger = try LedgerChange.saveEntry(entry, rule: rule).apply(to: Sample.ledger())
        let materialized = Recurrence.materialize(ledger, today: .day("2026-03-31"))
        #expect(materialized.transactions.map(\.date) == [.day("2026-01-31"), .day("2026-02-28"), .day("2026-03-31")])
    }

    @Test("whenEditingAnOccurrence_Build_ShouldKeepIdAndRuleAndIgnoreRepeat")
    func editOccurrence() throws {
        let original = Sample.entry("rent:2026-01-01", "2026-01-01", recurringId: "rent")
        let draft = EntryDraft(
            kind: .expense, title: "Rent", amount: "12", date: "2026-01-02", categoryId: "home", frequency: .weekly)
        let (entry, rule) = try draft.build(categories: Self.categories, editing: original, makeID: Self.ids())
        #expect(entry.id == "rent:2026-01-01" && entry.recurringId == "rent" && rule == nil)
        #expect(entry.date == .day("2026-01-02"))
    }

    @Test("whenScheduleDraftKeepsOrMovesNextDate_BuildSchedule_ShouldKeepOrReanchor")
    func buildSchedule() throws {
        let rule = Sample.rule("gym", start: "2026-01-31", next: "2026-02-28", anchorDay: 31, accountId: "visa")
        var draft = EntryDraft(
            kind: .expense, title: " Gym ", amount: "45", date: "2026-02-28", categoryId: "fun", frequency: .monthly)
        let kept = try draft.buildSchedule(categories: Self.categories, original: rule)
        #expect(kept.anchorDay == 31 && kept.nextDate == .day("2026-02-28") && kept.date == rule.date)
        #expect(kept.title == "Gym" && kept.share == 4500 && kept.categoryId == "fun")
        #expect(kept.accountId == nil, "clearing the account removes it from the rule")
        draft.date = "2026-03-15"
        let moved = try draft.buildSchedule(categories: Self.categories, original: rule)
        #expect(moved.anchorDay == 15 && moved.nextDate == .day("2026-03-15"))
        draft.frequency = nil
        #expect(throws: LedgerRuleError.chooseRepeat) {
            try draft.buildSchedule(categories: Self.categories, original: rule)
        }
    }

    /// The server stores `nextDate` only through 2100-12-31. A new repeating draft whose
    /// second occurrence would fall later could never sync, so it is refused with the person's
    /// input kept, instead of failing later as "Invalid ledger data.".
    @Test("whenRepeatingDraftsNextDateIsAfter2100_Build_ShouldRefuseBeforeSaving")
    func scheduleAfterLedgerRange() throws {
        func build(_ date: String, _ frequency: RecurrenceFrequency?, editing: LedgerEntry? = nil)
            throws(LedgerRuleError)
            -> RecurringRule?
        {
            let draft = EntryDraft(
                kind: .expense, title: "Gym", amount: "40", date: date, categoryId: "food", frequency: frequency)
            return try draft.build(categories: Self.categories, editing: editing, makeID: Self.ids()).rule
        }
        for (date, frequency) in [
            ("2100-12-15", RecurrenceFrequency.monthly), ("2100-12-25", .weekly), ("2100-01-01", .yearly),
        ] {
            #expect(throws: LedgerRuleError.scheduleAfterLedgerRange, "\(date) \(frequency)") {
                try build(date, frequency)
            }
        }
        #expect(try build("2100-12-24", .weekly)?.nextDate == .day("2100-12-31"))
        #expect(try build("2100-11-30", .monthly)?.nextDate == .day("2100-12-30"))
        #expect(try build("2100-12-31", nil) == nil, "a one-off entry on the last day is fine")
        // Editing ignores the repeat choice, so there is no rule to refuse.
        let occurrence = Sample.entry("gym:2100-12-31", "2100-12-31", recurringId: "gym")
        #expect(try build("2100-12-31", .monthly, editing: occurrence) == nil)
        #expect(LedgerRuleError.scheduleAfterLedgerRange.message.hasSuffix("."))
    }
}
