import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

/// The account, category and schedule forms and the schedule actions (MAZ-74), driven through
/// `FixedWorkspace` so a save really applies the ledger rule, or fails like storage would.
@Suite("Organize forms")
@MainActor
struct OrganizeFormTests {
    private static let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest
    private static let visa = PaymentAccount(id: "visa", name: "Visa", type: .credit)

    private static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }

    private static func rule(active: Bool = true, accountId: String? = "visa") -> RecurringRule {
        RecurringRule(
            id: "internet", title: "Internet", kind: .expense, total: 6_500, share: 6_500, categoryId: "home",
            accountId: accountId, date: day("2026-03-18"), frequency: .monthly, nextDate: day("2026-11-18"),
            anchorDay: 18, active: active)
    }

    private static func workspace(
        accounts: [PaymentAccount] = [visa], entries: [LedgerEntry] = [], rules: [RecurringRule] = [],
        failure: SaveFailure? = nil
    ) -> FixedWorkspace {
        FixedWorkspace(
            load: .ready(Ledger(accounts: accounts, transactions: entries, recurring: rules)), saveFailure: failure)
    }

    private static func commit(_ workspace: FixedWorkspace) -> LedgerCommit {
        { change, summary in
            if case .failure(let failure) = await workspace.commit(change, summary: summary) { return failure }
            return nil
        }
    }

    private static let storageFull = SaveFailure.storage("This device is out of space.")

    // MARK: Account form

    @Test("whenANewAccountIsSaved_AccountForm_ShouldReturnTheStoredAccountForTheCaller")
    func newAccount() async throws {
        let workspace = Self.workspace()
        let model = AccountFormModel(type: .cash, makeID: { "acct-1" })
        #expect(model.isNew && model.title == "New account" && !model.canSave)
        model.name = "  Wallet  "
        #expect(model.canSave)
        let saved = try #require(await model.save(with: Self.commit(workspace)))
        #expect(saved == PaymentAccount(id: "acct-1", name: "Wallet", type: .cash))
        #expect(workspace.load.ledger?.account(id: "acct-1") == saved)
        #expect(workspace.commits.last?.title == "Account added")
        #expect(model.failure == nil)
    }

    @Test("whenSavingFails_AccountForm_ShouldKeepTheDraftAndRetryWithTheSameId")
    func failedSaveKeepsDraft() async throws {
        let workspace = Self.workspace(failure: Self.storageFull)
        var made = 0
        let model = AccountFormModel(
            makeID: {
                made += 1
                return "acct-\(made)"
            })
        model.name = "Savings"
        model.type = .bank
        #expect(await model.save(with: Self.commit(workspace)) == nil)
        #expect(model.failure == Self.storageFull)
        #expect(model.name == "Savings" && model.type == .bank, "the draft stays")

        workspace.saveFailure = nil
        let saved = try #require(await model.save(with: Self.commit(workspace)))
        #expect(saved.id == "acct-1" && made == 1, "Try again never adds a second account")
        #expect(workspace.load.ledger?.accounts.count == 2)
        #expect(model.failure == nil)
    }

    @Test("whenTheNameIsTaken_AccountForm_ShouldShowTheRuleAndKeepTheDraft")
    func duplicateName() async {
        let workspace = Self.workspace()
        let model = AccountFormModel(makeID: { "acct-2" })
        model.name = "VISA"
        #expect(await model.save(with: Self.commit(workspace)) == nil)
        #expect(model.failure == .rule(.duplicateAccountName))
        #expect(model.failure?.message == "You already have an account with this name.")
        #expect(model.name == "VISA")
    }

    @Test("whenAnAccountIsInUse_AccountForm_ShouldExplainAndRefuseRemoval")
    func removeInUse() async {
        let entry = LedgerEntry(
            id: "e", title: "Lunch", kind: .expense, total: 900, share: 900, categoryId: "food", accountId: "visa",
            date: Self.today)
        let workspace = Self.workspace(entries: [entry], rules: [Self.rule()])
        let usage = workspace.load.ledger?.usage(ofAccount: "visa") ?? RecordUsage()
        #expect(
            AccountFormModel.removalNote(name: "Visa", usage: usage)
                == "Visa is used by 1 entry and 1 schedule. Move them to another account to remove it.")
        let model = AccountFormModel(account: Self.visa)
        #expect(await !model.remove(with: Self.commit(workspace)))
        #expect(model.failure == .rule(.accountHasEntries))
        #expect(workspace.load.ledger?.account(id: "visa") != nil)
    }

    @Test("whenAnAccountIsUnused_AccountForm_ShouldRemoveIt")
    func removeUnused() async {
        let workspace = Self.workspace()
        #expect(AccountFormModel.removalNote(name: "Visa", usage: RecordUsage()) == nil)
        let model = AccountFormModel(account: Self.visa)
        #expect(model.title == "Edit account")
        #expect(await model.remove(with: Self.commit(workspace)))
        #expect(workspace.load.ledger?.accounts.isEmpty == true)
        #expect(workspace.commits.last?.title == "Account removed")
    }

    @Test("whenTheAccountChangedOnAnotherDevice_AccountForm_ShouldRefuseTheStaleEdit")
    func staleAccount() async {
        let workspace = Self.workspace(accounts: [PaymentAccount(id: "visa", name: "Visa Gold", type: .credit)])
        let model = AccountFormModel(account: Self.visa)
        model.type = .bank
        #expect(await model.save(with: Self.commit(workspace)) == nil)
        #expect(model.failure == .rule(.accountChangedOnAnotherDevice))
    }

    // MARK: Category form

    @Test("whenANewCategoryIsSaved_CategoryForm_ShouldStoreThePaletteHexAndIcon")
    func newCategory() async throws {
        let workspace = Self.workspace()
        let model = CategoryFormModel(kind: .income, makeID: { "cat-1" })
        #expect(model.title == "New category" && model.kind == .income)
        model.name = "Tips"
        model.choose(.food)
        model.icon = "cash-outline"
        let saved = try #require(await model.save(with: Self.commit(workspace)))
        #expect(
            saved == LedgerCategory(id: "cat-1", name: "Tips", icon: "cash-outline", color: "#E0529C", kind: .income))
        #expect(saved.paletteColor == .food)
        #expect(workspace.load.ledger?.category(id: "cat-1") == saved)
        #expect(workspace.load.ledger?.violations.isEmpty == true)
    }

    @Test("whenCreatedFromAPickerSearch_CategoryForm_ShouldStartWithTheTrimmedSearchText")
    func suggestedName() async throws {
        let workspace = Self.workspace()
        let model = CategoryFormModel(kind: .expense, name: "  Pets ", makeID: { "cat-pets" })
        #expect(model.name == "Pets" && model.isNew)
        let saved = try #require(await model.save(with: Self.commit(workspace)))
        #expect(saved.id == "cat-pets" && saved.name == "Pets" && saved.kind == .expense)

        let food = try #require(Ledger.defaultCategories.first { $0.id == "food" })
        #expect(CategoryFormModel(category: food, name: "Ignored").name == food.name, "an edit keeps the stored name")
    }

    @Test("whenALegacyCategoryIsRenamed_CategoryForm_ShouldKeepItsStoredColor")
    func legacyColorKept() async throws {
        let workspace = Self.workspace()
        let food = try #require(Ledger.defaultCategories.first { $0.id == "food" })
        let model = CategoryFormModel(category: food)
        #expect(model.paletteColor == .food)
        model.name = "Eating out"
        let saved = try #require(await model.save(with: Self.commit(workspace)))
        #expect(saved.color == "#E47850", "an untouched legacy color is saved back as it was")
        #expect(saved.name == "Eating out")
    }

    @Test("whenACategoryIsInUse_CategoryForm_ShouldLockItsKindAndRefuseRemoval")
    func categoryInUse() async throws {
        let workspace = Self.workspace(rules: [Self.rule()])
        let ledger = try #require(workspace.load.ledger)
        let home = try #require(ledger.category(id: "home"))
        let model = CategoryFormModel(category: home)
        #expect(!model.canChangeKind(in: ledger))
        #expect(CategoryFormModel(kind: .expense).canChangeKind(in: ledger), "a new category can pick its kind")
        #expect(
            CategoryFormModel.removalNote(name: "Home", usage: ledger.usage(ofCategory: "home"))
                == "Home is used by 1 schedule. Keep it to preserve your history.")
        #expect(await !model.remove(with: Self.commit(workspace)))
        #expect(model.failure == .rule(.categoryHasEntries))
    }

    // MARK: Schedule form

    @Test("whenAScheduleIsEdited_ScheduleForm_ShouldChangeTheRuleAndKeepRecordedEntries")
    func editSchedule() async throws {
        let wallet = PaymentAccount(id: "wallet", name: "Wallet", type: .cash)
        let original = Self.rule()
        let recorded = Recurrence.occurrence(of: original, on: Self.day("2026-10-18"))
        let workspace = Self.workspace(accounts: [Self.visa, wallet], entries: [recorded], rules: [original])
        let model = ScheduleFormModel(rule: original)
        #expect(model.title == "Edit schedule" && model.date == original.nextDate)
        model.draft.amount = "70"
        model.draft.accountId = "wallet"
        model.draft.frequency = .yearly
        let categories = workspace.load.ledger?.categories ?? []
        let saved = try #require(await model.save(categories: categories, with: Self.commit(workspace)))
        #expect(saved.total == 7_000 && saved.accountId == "wallet" && saved.frequency == .yearly)
        #expect(workspace.load.ledger?.rule(id: "internet") == saved)
        #expect(workspace.load.ledger?.transactions == [recorded], "recorded entries keep their details")
        #expect(workspace.commits.last?.title == "Schedule updated")
    }

    @Test("whenANewScheduleIsSaved_ScheduleForm_ShouldRecordTheFirstDateAndStartTheRule")
    func newSchedule() async throws {
        let workspace = Self.workspace()
        var ids = ["entry-1", "rule-1"].makeIterator()
        let categories = Ledger.defaultCategories
        let model = ScheduleFormModel(
            today: Self.day("2027-01-31"), categories: categories, makeID: { ids.next() ?? "" })
        #expect(model.isNew && model.draft.frequency == .monthly)
        model.draft.title = "Rent"
        model.draft.amount = "1200"
        model.draft.categoryId = "home"
        model.draft.accountId = "visa"
        let rule = try #require(await model.save(categories: categories, with: Self.commit(workspace)))
        let ledger = try #require(workspace.load.ledger)
        #expect(rule.id == "rule-1" && rule.nextDate == Self.day("2027-02-28") && rule.anchorDay == 31)
        #expect(ledger.rule(id: "rule-1") == rule)
        #expect(ledger.entry(id: "entry-1")?.recurringId == "rule-1")
        #expect(workspace.commits.last?.title == "Schedule added")
    }

    @Test("whenTheDraftIsInvalid_ScheduleForm_ShouldShowTheReasonAndSaveNothing")
    func invalidSchedule() async {
        let workspace = Self.workspace(rules: [Self.rule()])
        let model = ScheduleFormModel(rule: Self.rule())
        model.draft.amount = "0"
        #expect(await model.save(categories: Ledger.defaultCategories, with: Self.commit(workspace)) == nil)
        #expect(model.failure == .rule(.zeroAmount))
        #expect(model.draft.amount == "0", "the draft stays as typed")
        #expect(workspace.commits.isEmpty)
    }

    @Test("whenStorageFails_ScheduleForm_ShouldKeepTheDraftAndRetrySavingOnce")
    func failedScheduleSave() async throws {
        let workspace = Self.workspace(failure: Self.storageFull)
        var ids = ["entry-1", "rule-1", "unexpected"].makeIterator()
        let categories = Ledger.defaultCategories
        let model = ScheduleFormModel(today: Self.today, categories: categories, makeID: { ids.next() ?? "" })
        model.draft.title = "Gym"
        model.draft.amount = "45"
        #expect(await model.save(categories: categories, with: Self.commit(workspace)) == nil)
        #expect(model.failure == Self.storageFull)
        #expect(model.draft.title == "Gym" && model.draft.amount == "45")

        workspace.saveFailure = nil
        let rule = try #require(await model.save(categories: categories, with: Self.commit(workspace)))
        #expect(rule.id == "rule-1")
        #expect(workspace.load.ledger?.recurring.count == 1 && workspace.load.ledger?.transactions.count == 1)
    }

    @Test("whenAnAccountOrCategoryIsCreatedInline_ScheduleForm_ShouldSelectItAndKeepTheRestOfTheDraft")
    func inlineCreation() async throws {
        let workspace = Self.workspace(rules: [Self.rule(accountId: nil)])
        let model = ScheduleFormModel(rule: Self.rule(accountId: nil))
        model.draft.title = "Fibre internet"
        model.draft.amount = "72.50"
        let before = model.draft

        let accountForm = AccountFormModel(type: .bank, makeID: { "acct-new" })
        accountForm.name = "Joint chequing"
        let account = try #require(await accountForm.save(with: Self.commit(workspace)))
        model.accountCreated(account)

        let categoryForm = CategoryFormModel(kind: .expense, makeID: { "cat-new" })
        categoryForm.name = "Utilities"
        let category = try #require(await categoryForm.save(with: Self.commit(workspace)))
        model.categoryCreated(category)

        var expected = before
        expected.accountId = "acct-new"
        expected.categoryId = "cat-new"
        #expect(model.draft == expected, "only the new selections changed")

        let income = LedgerCategory(
            id: "cat-income", name: "Refunds", icon: "cash-outline", color: "#0FA3A3", kind: .income)
        model.categoryCreated(income)
        #expect(model.draft.categoryId == "cat-new", "a category of another kind isn't selected")

        let categories = workspace.load.ledger?.categories ?? []
        let saved = try #require(await model.save(categories: categories, with: Self.commit(workspace)))
        #expect(saved.accountId == "acct-new" && saved.categoryId == "cat-new" && saved.total == 7_250)
    }

    @Test("whenTheKindChanges_ScheduleForm_ShouldChooseACategoryOfThatKind")
    func kindChange() {
        let model = ScheduleFormModel(rule: Self.rule())
        model.setKind(.investment, categories: Ledger.defaultCategories)
        #expect(model.draft.kind == .investment && model.draft.categoryId == "investments")
    }

    // MARK: Schedule actions

    @Test("whenPausedAndResumedFromItsPage_Schedule_ShouldSkipThePausedDates")
    func toggle() async throws {
        let workspace = Self.workspace(rules: [Self.rule()])
        let commit = Self.commit(workspace)
        let pause = ScheduleActions.toggle(Self.rule(), today: Self.today)
        #expect(pause.1.title == "Schedule paused")
        #expect(await commit(pause.0, pause.1) == nil)
        let paused = try #require(workspace.load.ledger?.rule(id: "internet"))
        #expect(!paused.active && paused.nextDate == Self.day("2026-11-18"))

        let resumeDay = Self.day("2026-12-20")
        let resume = ScheduleActions.toggle(paused, today: resumeDay)
        #expect(resume.1.title == "Schedule resumed")
        #expect(await commit(resume.0, resume.1) == nil)
        let resumed = try #require(workspace.load.ledger?.rule(id: "internet"))
        #expect(resumed.active && resumed.nextDate == Self.day("2027-01-18"))
    }

    @Test("whenPaused_ScheduleDetail_ShouldPreviewTheDatesResumingTodayWouldGive")
    func pausedPreview() throws {
        let paused = Self.rule(active: false)
        let ledger = Ledger(accounts: [Self.visa], recurring: [paused])
        let dates = ScheduleDetailView.upcoming(paused, ledger: ledger, today: Self.day("2026-12-20"))
        #expect(dates.map(\.description) == ["2027-01-18", "2027-02-18", "2027-03-18"])
        let active = ScheduleDetailView.upcoming(Self.rule(), ledger: ledger, today: Self.today)
        #expect(active.first == Self.day("2026-11-18"))
    }

    @Test("whenRemoved_Schedule_ShouldStopAndKeepItsRecordedEntries")
    func remove() async {
        let recorded = Recurrence.occurrence(of: Self.rule(), on: Self.day("2026-10-18"))
        let workspace = Self.workspace(entries: [recorded], rules: [Self.rule()])
        let action = ScheduleActions.remove(Self.rule())
        #expect(action.1.title == "Schedule removed")
        #expect(await Self.commit(workspace)(action.0, action.1) == nil)
        #expect(workspace.load.ledger?.recurring.isEmpty == true)
        #expect(workspace.load.ledger?.transactions == [recorded])
    }

    // MARK: Text

    @Test("whenSchedulesAreDescribed_ScheduleText_ShouldNameCadenceAndMonthEnds")
    func cadence() {
        #expect(ScheduleText.cadence(Self.rule()) == "Every month on the 18th")
        var rule = Self.rule()
        rule.anchorDay = 31
        #expect(ScheduleText.cadence(rule) == "Every month on the 31st, or the last day of shorter months")
        rule.frequency = .weekly
        #expect(ScheduleText.cadence(rule) == "Every week on Wednesday", "2026-11-18 is a Wednesday")
        rule.frequency = .yearly
        rule.anchorDay = 18
        #expect(ScheduleText.cadence(rule) == "Every year on November 18")
        #expect(
            ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]
                == [
                    1, 2, 3, 4, 11, 12, 13, 21, 22, 23,
                ].map(ScheduleText.ordinal))
        #expect(ScheduleText.relative(Self.day("2026-11-18"), today: Self.today) == "in 9 days")
        #expect(ScheduleText.relative(Self.today, today: Self.today) == "Today")
        #expect(ScheduleText.relative(Self.today.adding(days: 1), today: Self.today) == "Tomorrow")
    }

    @Test("whenSchedulesAreListed_RecurringList_ShouldShowActiveByNextDateThenPaused")
    func ordering() {
        var early = Self.rule()
        early.id = "early"
        early.nextDate = Self.day("2026-11-10")
        var paused = Self.rule(active: false)
        paused.id = "paused"
        paused.nextDate = Self.day("2026-11-01")
        let sorted = RecurringListView.sorted([paused, Self.rule(), early])
        #expect(sorted.map(\.id) == ["early", "internet", "paused"])
        #expect(ScheduleText.row(paused, account: Self.visa, today: Self.today) == "Paused · monthly · Visa")
        #expect(ScheduleText.meaning(paused) == .neutral)
    }

    @Test("whenAccountsAreListed_OrganizeText_ShouldShowTypeAndUseButNeverABalance")
    func accountRows() {
        #expect(
            OrganizeText.accountDetail(Self.visa, usage: RecordUsage(entries: 31, schedules: 3))
                == "Credit card · 31 entries, 3 schedules")
        #expect(
            OrganizeText.accountDetail(PaymentAccount(id: "s", name: "Savings", type: .bank), usage: RecordUsage())
                == "Bank account · not used yet")
        #expect(AccountType.allCases.map(OrganizeText.accountType) == ["Bank account", "Credit card", "Cash", "Other"])
        #expect(OrganizeText.categoryDetail(RecordUsage(entries: 1)) == "1 entry")
    }
}
