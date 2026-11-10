import PennyDomain
import Testing

@Suite("Entry editor (MAZ-73)")
struct EntryEditorTests {
    static let today = CalendarDate.day("2026-11-09")

    /// Ids handed out in order, so tests can name what a save creates.
    final class IDs {
        private var next = 0
        func make() -> String {
            next += 1
            return "id-\(next)"
        }
    }

    static func ledger(_ entries: [LedgerEntry] = []) -> Ledger {
        Ledger(accounts: [Sample.visa], trips: [Sample.lisbon], transactions: entries)
    }

    static func filled(_ editor: inout EntryEditor, amount: String = "74.40", title: String = "Dinner") {
        editor.draft.amount = amount
        editor.draft.title = title
    }

    // MARK: Starting

    @Test("whenANewEntryOpens_EntryEditor_ShouldStartTodayOnTheMostUsedCategory")
    func newDraft() {
        let ledger = Self.ledger([
            Sample.entry("a", "2026-11-01", category: "transport"),
            Sample.entry("b", "2026-11-02", category: "transport"),
            Sample.entry("c", "2026-11-03", category: "food"),
        ])
        let editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        #expect(editor.draft.date == "2026-11-09")
        #expect(editor.draft.categoryId == "transport")
        #expect(editor.isNew && !editor.isDirty && editor.phase == .editing)
    }

    @Test("whenCategoriesAreRanked_Ledger_ShouldPutTheMostUsedOfTheKindFirstAndKeepLedgerOrderForTies")
    func categoriesByUse() {
        let ledger = Self.ledger([
            Sample.entry("a", "2026-11-01", category: "health"), Sample.entry("b", "2026-11-02", category: "health"),
            Sample.entry("c", "2026-11-03", category: "home"),
            Sample.entry("d", "2026-11-03", kind: .income, category: "salary"),
        ])
        let ids = ledger.categoriesByUse(.expense).map(\.id)
        #expect(Array(ids.prefix(3)) == ["health", "home", "groceries"])
        #expect(ids.count == Ledger.defaultCategories.filter { $0.kind == .expense }.count)
        #expect(ledger.categoriesByUse(.income).first?.id == "salary")
        #expect(ledger.categoriesByUse(.investment).map(\.id) == ["investments"])
    }

    @Test("whenTheKindSwitchesAndBack_EntryEditor_ShouldRestoreTheCategoryChosenForEachKind")
    func kindSwitch() {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        editor.draft.categoryId = "health"
        editor.setKind(.income, ledger: ledger)
        #expect(editor.draft.kind == .income)
        #expect(editor.draft.categoryId == "salary")
        editor.draft.categoryId = "gift"
        editor.setKind(.expense, ledger: ledger)
        #expect(editor.draft.categoryId == "health")
        editor.setKind(.income, ledger: ledger)
        #expect(editor.draft.categoryId == "gift")
    }

    @Test("whenEditingASplitEntry_EntryDraft_ShouldOpenAsYourShareAmount")
    func editingSplit() {
        let entry = Sample.entry("a", "2026-11-02", share: 640, total: 1280, accountId: "visa", tripId: "lisbon")
        let draft = EntryDraft(editing: entry)
        #expect(draft.amount == "12.80")
        #expect(draft.split == .amount && draft.shareInput == "6.40")
        #expect(draft.accountId == "visa" && draft.tripId == "lisbon")
        let whole = EntryDraft(editing: Sample.entry("b", "2026-11-02", share: 5))
        #expect(whole.amount == "0.05" && whole.split == .full && whole.shareInput.isEmpty)
    }

    // MARK: Saving

    @Test(
        "whenEachKindAndSplitIsSaved_EntryEditor_ShouldRecordTheShare",
        arguments: [
            (EntryKind.expense, Money.SplitMode.full, "", Int64(7440)),
            (.expense, .equal, "3", 2480),
            (.expense, .amount, "20", 2000),
            (.expense, .percent, "25", 1860),
            (.income, .equal, "3", 7440),
            (.investment, .percent, "50", 7440),
        ])
    func kindsAndSplits(kind: EntryKind, split: Money.SplitMode, input: String, share: Int64) throws {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: kind, today: Self.today, ledger: ledger)
        Self.filled(&editor)
        editor.draft.split = split
        editor.draft.shareInput = input
        editor.draft.tripId = "lisbon"
        let ids = IDs()
        guard case .ready(let attempt) = editor.beginSave(in: ledger, makeID: ids.make) else {
            Issue.record("the draft is valid")
            return
        }
        #expect(attempt.entry.total == 7440)
        #expect(attempt.entry.share == share)
        #expect(attempt.entry.tripId == (kind == .expense ? "lisbon" : nil), "only expenses keep a trip")
        let saved = try attempt.change.apply(to: ledger)
        #expect(saved.entry(id: "id-1")?.share == share)
    }

    @Test("whenSaveIsTappedTwice_EntryEditor_ShouldStartOnlyOneSave")
    func duplicateSubmit() {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        Self.filled(&editor)
        let ids = IDs()
        guard case .ready(let first) = editor.beginSave(in: ledger, makeID: ids.make) else {
            Issue.record("the first save starts")
            return
        }
        guard case .alreadySaving = editor.beginSave(in: ledger, makeID: ids.make) else {
            Issue.record("a second tap while saving does nothing")
            return
        }
        editor.finish(first.number, failure: nil)
        #expect(editor.isSaved)
        guard case .alreadySaving = editor.beginSave(in: ledger, makeID: ids.make) else {
            Issue.record("a tap after the save does nothing")
            return
        }
    }

    @Test("whenTheDraftIsInvalid_EntryEditor_ShouldKeepItAsTypedAndNameTheReason")
    func invalidDraft() {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        Self.filled(&editor, amount: "12.345", title: "  Lunch ")
        guard case .invalid(.invalidAmount) = editor.beginSave(in: ledger, makeID: { "x" }) else {
            Issue.record("three decimals are refused")
            return
        }
        #expect(editor.failure?.message == "Enter an amount with up to two decimal places.")
        #expect(editor.draft.amount == "12.345" && editor.draft.title == "  Lunch ", "the draft is unchanged")
        editor.draft.amount = "12.34"
        editor.draft.title = ""
        guard case .invalid(.missingTitle) = editor.beginSave(in: ledger, makeID: { "x" }) else {
            Issue.record("a name is required")
            return
        }
        editor.draft.title = "Lunch"
        editor.draft.split = .equal
        editor.draft.shareInput = "1"
        guard case .invalid(.invalidSplitPeople) = editor.beginSave(in: ledger, makeID: { "x" }) else {
            Issue.record("a split needs 2 to 100 people")
            return
        }
    }

    @Test("whenAnOlderAttemptAnswersLate_EntryEditor_ShouldIgnoreIt")
    func lateAnswer() {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        Self.filled(&editor)
        guard case .ready(let first) = editor.beginSave(in: ledger, makeID: { "a" }) else { return }
        editor.finish(first.number, failure: EntrySaveFailure(message: "Disk full"))
        #expect(editor.failure?.message == "Disk full")
        guard case .ready(let second) = editor.beginSave(in: ledger, makeID: { "b" }) else {
            Issue.record("Try again starts a new save")
            return
        }
        editor.finish(first.number, failure: nil)
        #expect(editor.isSaving, "the first attempt's answer no longer counts")
        editor.finish(second.number, failure: nil)
        #expect(editor.isSaved)
    }

    @Test("whenTheEntryChangedOnAnotherDevice_EntryEditor_ShouldReportAConflictAndReviewTheLatest")
    func staleEdit() throws {
        let original = Sample.entry("a", "2026-11-02", title: "Lunch")
        var editor = EntryEditor(editing: original)
        editor.draft.title = "Team lunch"
        var latest = original
        latest.note = "Edited on the web"
        let ledger = Self.ledger([latest])
        guard case .ready(let attempt) = editor.beginSave(in: ledger, makeID: { "unused" }) else {
            Issue.record("the draft itself is valid")
            return
        }
        #expect(throws: LedgerRuleError.entryChangedOnAnotherDevice) { try attempt.change.apply(to: ledger) }
        editor.finish(attempt.number, failure: EntrySaveFailure(rule: .entryChangedOnAnotherDevice))
        #expect(editor.hasConflict)
        #expect(editor.draft.title == "Team lunch", "the person's edit is kept until they choose")
        let reviewed = editor.reviewLatest(latest)
        #expect(reviewed)
        #expect(editor.original == latest && editor.draft.note == "Edited on the web" && !editor.hasConflict)
        let reopened = editor.reviewLatest(nil)
        #expect(!reopened, "an entry deleted elsewhere closes the form")
    }

    @Test("whenADeleteTargetsAStaleEntry_LedgerChange_ShouldRefuseIt")
    func staleDelete() {
        let original = Sample.entry("a", "2026-11-02")
        var latest = original
        latest.title = "Renamed"
        #expect(throws: LedgerRuleError.entryChangedBeforeDelete) {
            try LedgerChange.deleteEntry(original).apply(to: Self.ledger([latest]))
        }
        #expect(throws: LedgerRuleError.entryChangedBeforeDelete) {
            try LedgerChange.deleteEntry(original).apply(to: Self.ledger())
        }
    }

    @Test("whenANewEntryRepeats_EntryEditor_ShouldStartASchedule")
    func repeating() throws {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .income, today: Self.today, ledger: ledger)
        Self.filled(&editor, amount: "3200", title: "Payday")
        editor.draft.frequency = .monthly
        let ids = IDs()
        guard case .ready(let attempt) = editor.beginSave(in: ledger, makeID: ids.make) else { return }
        #expect(attempt.rule?.nextDate == .day("2026-12-09"))
        #expect(attempt.entry.recurringId == attempt.rule?.id)
        #expect(try attempt.change.apply(to: ledger).recurring.count == 1)
    }

    // MARK: Drafts kept for later

    @Test("whenAFormClosesWithUnsavedWork_EntryDraftShelf_ShouldKeepItOnceAndOnlyThen")
    func shelf() {
        let ledger = Self.ledger([Sample.entry("a", "2026-11-02")])
        var shelf = EntryDraftShelf()
        var editor = EntryEditor(new: .expense, today: Self.today, ledger: ledger)
        shelf.keep(editor)
        #expect(!shelf.has(.new), "an untouched form leaves nothing behind")
        Self.filled(&editor)
        shelf.keep(editor)
        let kept = shelf.take(.new)
        #expect(kept?.draft.title == "Dinner")
        let again = shelf.take(.new)
        #expect(again == nil, "taking it removes it")

        guard case .ready(let attempt) = editor.beginSave(in: ledger, makeID: { "x" }) else { return }
        shelf.keep(editor)
        #expect(!shelf.has(.new), "a draft being saved is not kept")
        editor.finish(attempt.number, failure: nil)
        shelf.keep(editor)
        #expect(!shelf.has(.new), "a saved draft is not kept")

        let entry = Sample.entry("a", "2026-11-02")
        var edit = EntryEditor(editing: entry)
        edit.draft.note = "Half was a gift"
        shelf.keep(edit)
        #expect(shelf.has(.edit(entry)) && !shelf.has(.new))
        shelf.discard(.edit(entry))
        #expect(!shelf.has(.edit(entry)))
    }

    // MARK: Keypad

    @Test(
        "whenKeysArePressed_AmountInput_ShouldFollowTheAmountRules",
        arguments: [
            ("", AmountInput.Key.digit(7), "7"),
            ("0", .digit(5), "5"),
            ("", .separator, "0."),
            ("12", .separator, "12."),
            ("12.3", .separator, "12.3"),
            ("12.34", .digit(5), "12.34"),
            ("123456789", .digit(1), "123456789"),
            ("12.3", .delete, "12."),
            ("", .delete, ""),
            ("1", .digit(10), "1"),
        ])
    func keypad(text: String, key: AmountInput.Key, expected: String) {
        #expect(AmountInput.apply(key, to: text) == expected)
    }

    @Test("whenTheKeypadTypesAnAmount_Money_ShouldParseIt")
    func keypadParses() throws {
        var text = ""
        for key: AmountInput.Key in [.digit(0), .digit(7), .separator, .digit(4)] {
            text = AmountInput.apply(key, to: text)
        }
        #expect(text == "7.4")
        #expect(try Money.cents(text) == 740)
        #expect(try Money.cents(AmountInput.apply(.separator, to: "12")) == 1200)
        #expect(AmountInput.text(cents: 99_999_999_999) == "999999999.99")
    }
}
