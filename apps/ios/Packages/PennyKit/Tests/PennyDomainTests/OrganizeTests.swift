import PennyDomain
import Testing

/// Accounts, categories and recurring schedules as the organize pages use them (MAZ-74):
/// usage counts and removal guards, every account type, schedule drafts and editing,
/// pause/resume and month-end recurrence. Fixture data only.
@Suite("Organize: accounts, categories and schedules")
struct OrganizeTests {
    private static func day(_ text: String) -> CalendarDate {
        guard let date = CalendarDate(text) else { preconditionFailure(text) }
        return date
    }

    private static let visa = PaymentAccount(id: "visa", name: "Visa", type: .credit)
    private static let wallet = PaymentAccount(id: "wallet", name: "Wallet", type: .cash)

    private static func rule(
        _ id: String = "internet", next: String = "2026-11-18", anchor: Int = 18, accountId: String? = nil,
        categoryId: String = "home", frequency: RecurrenceFrequency = .monthly, active: Bool = true,
        total: Int64 = 6_500, share: Int64 = 6_500
    ) -> RecurringRule {
        RecurringRule(
            id: id, title: "Internet", kind: .expense, total: total, share: share, categoryId: categoryId,
            accountId: accountId, date: day("2026-03-18"), frequency: frequency, nextDate: day(next),
            anchorDay: anchor, active: active)
    }

    private static func entry(_ id: String, accountId: String? = nil, categoryId: String = "food") -> LedgerEntry {
        LedgerEntry(
            id: id, title: "Lunch", kind: .expense, total: 1_250, share: 1_250, categoryId: categoryId,
            accountId: accountId, date: day("2026-11-02"))
    }

    // MARK: Usage and removal guards

    @Test("whenEntriesAndSchedulesUseRecords_Ledger_ShouldCountEachSeparately")
    func usage() {
        let ledger = Ledger(
            accounts: [Self.visa, Self.wallet],
            transactions: [Self.entry("a", accountId: "visa"), Self.entry("b", accountId: "visa"), Self.entry("c")],
            recurring: [Self.rule(accountId: "visa")])
        #expect(ledger.usage(ofAccount: "visa") == RecordUsage(entries: 2, schedules: 1))
        #expect(ledger.usage(ofAccount: "wallet") == RecordUsage())
        #expect(!ledger.usage(ofAccount: "wallet").isInUse)
        #expect(ledger.usage(ofCategory: "food") == RecordUsage(entries: 3, schedules: 0))
        #expect(ledger.usage(ofCategory: "home") == RecordUsage(entries: 0, schedules: 1))
        #expect(ledger.usage(ofCategory: "home").isInUse)
    }

    @Test("whenAnAccountIsLinkedOnlyToASchedule_RemoveAccount_ShouldBeRefusedAndChangeNothing")
    func accountLinkedToSchedule() throws {
        let ledger = Ledger(accounts: [Self.visa], recurring: [Self.rule(accountId: "visa")])
        #expect(throws: LedgerRuleError.accountHasEntries) {
            try LedgerChange.saveAccount(Self.visa, original: Self.visa, remove: true).apply(to: ledger)
        }
        let withEntry = Ledger(accounts: [Self.visa], transactions: [Self.entry("a", accountId: "visa")])
        #expect(throws: LedgerRuleError.accountHasEntries) {
            try LedgerChange.saveAccount(Self.visa, original: Self.visa, remove: true).apply(to: withEntry)
        }
        let unused = try LedgerChange.saveAccount(Self.visa, original: Self.visa, remove: true)
            .apply(to: Ledger(accounts: [Self.visa, Self.wallet]))
        #expect(unused.accounts == [Self.wallet])
    }

    @Test("whenAnAccountInUseIsRenamed_SaveAccount_ShouldKeepEveryLinkedEntry")
    func renameInUse() throws {
        let ledger = Ledger(accounts: [Self.visa], transactions: [Self.entry("a", accountId: "visa")])
        var renamed = Self.visa
        renamed.name = "  Visa Infinite  "
        let next = try LedgerChange.saveAccount(renamed, original: Self.visa).apply(to: ledger)
        #expect(next.account(id: "visa")?.name == "Visa Infinite", "trimmed")
        #expect(next.transactions == ledger.transactions)
        #expect(renamed.trimmed().name == "Visa Infinite")
    }

    @Test("whenACategoryIsUsedByASchedule_RemoveOrChangeKind_ShouldBeRefused")
    func categoryGuards() throws {
        let home = try #require(Ledger.defaultCategories.first { $0.id == "home" })
        let ledger = Ledger(recurring: [Self.rule()])
        #expect(throws: LedgerRuleError.categoryHasEntries) {
            try LedgerChange.saveCategory(home, original: home, remove: true).apply(to: ledger)
        }
        var income = home
        income.kind = .income
        #expect(throws: LedgerRuleError.categoryKindInUse) {
            try LedgerChange.saveCategory(income, original: home).apply(to: ledger)
        }
        let unused = try LedgerChange.saveCategory(income, original: home).apply(to: Ledger())
        #expect(unused.category(id: "home")?.kind == .income, "an unused category can change kind")
    }

    @Test(
        "whenEachAccountTypeIsSaved_SaveAccount_ShouldStoreTheType",
        arguments: AccountType.allCases)
    func everyAccountType(type: AccountType) throws {
        let account = PaymentAccount(id: "acct-\(type.rawValue)", name: "Account \(type.rawValue)", type: type)
        let ledger = try LedgerChange.saveAccount(account).apply(to: Ledger())
        #expect(ledger.account(id: account.id)?.type == type)
        #expect(ledger.violations.isEmpty)
    }

    // MARK: Schedule drafts

    @Test("whenAnUntouchedScheduleDraftIsRebuilt_BuildSchedule_ShouldReturnTheSameRule")
    func untouchedDraft() throws {
        let rules = [
            Self.rule(),
            Self.rule("split", total: 12_000, share: 4_000),
            Self.rule("month-end", next: "2027-02-28", anchor: 31),
            Self.rule("weekly", next: "2026-11-17", anchor: 17, frequency: .weekly),
        ]
        for rule in rules {
            let draft = EntryDraft(schedule: rule)
            #expect(try draft.buildSchedule(categories: Ledger.defaultCategories, original: rule) == rule, "\(rule.id)")
        }
        let split = EntryDraft(schedule: rules[1])
        #expect(split.split == .amount && split.shareInput == "40.00" && split.amount == "120.00")
        #expect(EntryDraft(schedule: rules[2]).date == "2027-02-28")
    }

    @Test("whenTheNextDateMoves_BuildSchedule_ShouldReAnchorOnTheNewDay")
    func reAnchor() throws {
        let original = Self.rule("month-end", next: "2027-02-28", anchor: 31)
        var draft = EntryDraft(schedule: original)
        draft.date = "2027-03-15"
        let moved = try draft.buildSchedule(categories: Ledger.defaultCategories, original: original)
        #expect(moved.nextDate == Self.day("2027-03-15") && moved.anchorDay == 15)
        #expect(moved.date == original.date, "the first date never changes")
    }

    @Test("whenAScheduleDraftIsInvalid_BuildSchedule_ShouldThrowTheLegacyMessage")
    func invalidDraft() {
        let original = Self.rule()
        var draft = EntryDraft(schedule: original)
        draft.amount = "12.345"
        #expect(throws: LedgerRuleError.invalidAmount) {
            try draft.buildSchedule(categories: Ledger.defaultCategories, original: original)
        }
        draft = EntryDraft(schedule: original)
        draft.title = "   "
        #expect(throws: LedgerRuleError.missingTitle) {
            try draft.buildSchedule(categories: Ledger.defaultCategories, original: original)
        }
        draft = EntryDraft(schedule: original)
        draft.frequency = nil
        #expect(throws: LedgerRuleError.chooseRepeat) {
            try draft.buildSchedule(categories: Ledger.defaultCategories, original: original)
        }
    }

    @Test("whenTheKindSwitches_EntryDraft_ShouldPickACategoryOfThatKindAndDropTheSplit")
    func switchKind() {
        var draft = EntryDraft(schedule: Self.rule(total: 12_000, share: 4_000))
        draft.switchKind(to: .income, categories: Ledger.defaultCategories)
        #expect(draft.kind == .income && draft.categoryId == "salary" && draft.split == .full)
        draft.categoryId = "freelance"
        draft.switchKind(to: .income, categories: Ledger.defaultCategories)
        #expect(draft.categoryId == "freelance", "same kind keeps the choice")
    }

    @Test("whenANewScheduleIsStarted_NewScheduleDraft_ShouldRecordTheFirstDateAndRepeatAfterIt")
    func newSchedule() throws {
        var draft = EntryDraft.newSchedule(today: Self.day("2027-01-31"), categories: Ledger.defaultCategories)
        #expect(draft.frequency == .monthly && draft.categoryId == "groceries" && draft.kind == .expense)
        draft.title = "Rent"
        draft.amount = "1200"
        draft.categoryId = "home"
        var ids = ["entry-1", "rule-1"].makeIterator()
        let built = try draft.build(categories: Ledger.defaultCategories, makeID: { ids.next() ?? "" })
        let rule = try #require(built.rule)
        #expect(built.entry.id == "entry-1" && built.entry.recurringId == "rule-1")
        #expect(rule.nextDate == Self.day("2027-02-28") && rule.anchorDay == 31)
    }

    // MARK: Editing and occurrences

    @Test("whenAScheduleIsEdited_RecordedOccurrences_ShouldKeepTheirOriginalDetails")
    func editKeepsOccurrences() throws {
        let original = Self.rule(next: "2026-10-18", accountId: "visa")
        var ledger = Recurrence.materialize(
            Ledger(accounts: [Self.visa, Self.wallet], recurring: [original]), today: Self.day("2026-11-20"))
        let recorded = ledger.transactions
        #expect(recorded.map(\.id) == ["internet:2026-10-18", "internet:2026-11-18"])
        let current = try #require(ledger.rule(id: "internet"))

        var draft = EntryDraft(schedule: current)
        draft.amount = "70.00"
        draft.accountId = "wallet"
        draft.categoryId = "other"
        let edited = try draft.buildSchedule(categories: ledger.categories, original: current)
        ledger = try LedgerChange.saveSchedule(edited, original: current).apply(to: ledger)
        #expect(ledger.transactions == recorded, "history is untouched")

        ledger = Recurrence.materialize(ledger, today: Self.day("2026-12-18"))
        let december = try #require(ledger.entry(id: "internet:2026-12-18"))
        #expect(december.total == 7_000 && december.accountId == "wallet" && december.categoryId == "other")
        #expect(ledger.entry(id: "internet:2026-11-18")?.total == 6_500)
    }

    @Test("whenAScheduleChangedOnAnotherDevice_SaveSchedule_ShouldRefuseTheStaleEdit")
    func staleSchedule() throws {
        let original = Self.rule()
        var elsewhere = original
        elsewhere.title = "Fibre"
        let ledger = Ledger(recurring: [elsewhere])
        var mine = original
        mine.total = 7_000
        mine.share = 7_000
        #expect(throws: LedgerRuleError.scheduleChangedOnAnotherDevice) {
            try LedgerChange.saveSchedule(mine, original: original).apply(to: ledger)
        }
    }

    @Test("whenAScheduleUsesARemovedAccount_SaveSchedule_ShouldAskForAnotherAccount")
    func removedAccount() {
        let original = Self.rule()
        var edited = original
        edited.accountId = "gone"
        #expect(throws: LedgerRuleError.accountRemoved) {
            try LedgerChange.saveSchedule(edited, original: original).apply(to: Ledger(recurring: [original]))
        }
    }

    // MARK: Pause and resume

    @Test("whenPausedThenResumed_Schedule_ShouldRecordNothingForThePausedDates")
    func pauseResume() throws {
        var ledger = Ledger(recurring: [Self.rule(next: "2026-09-18")])
        ledger = try LedgerChange.setScheduleActive(id: "internet", active: false, today: Self.day("2026-09-01"))
            .apply(to: ledger)
        ledger = Recurrence.materialize(ledger, today: Self.day("2026-11-25"))
        #expect(ledger.transactions.isEmpty, "a paused schedule records nothing")
        #expect(ledger.rule(id: "internet")?.nextDate == Self.day("2026-09-18"), "pausing keeps the next date")

        ledger = try LedgerChange.setScheduleActive(id: "internet", active: true, today: Self.day("2026-11-25"))
            .apply(to: ledger)
        #expect(ledger.rule(id: "internet")?.nextDate == Self.day("2026-12-18"), "resuming skips missed dates")
        ledger = Recurrence.materialize(ledger, today: Self.day("2026-11-25"))
        #expect(ledger.transactions.isEmpty)
    }

    @Test("whenAScheduleIsRemoved_RecordedEntries_ShouldStayWithTheirScheduleId")
    func removeKeepsHistory() throws {
        var ledger = Recurrence.materialize(
            Ledger(recurring: [Self.rule(next: "2026-10-18")]), today: Self.day("2026-11-20"))
        ledger = try LedgerChange.removeSchedule(id: "internet").apply(to: ledger)
        #expect(ledger.recurring.isEmpty)
        #expect(ledger.transactions.count == 2 && ledger.transactions.allSatisfy { $0.recurringId == "internet" })
        #expect(ledger.violations.isEmpty)
    }

    // MARK: Upcoming dates

    @Test("whenARuleIsAnchoredOnThe31st_UpcomingDates_ShouldUseEachMonthsLastDay")
    func monthEnd() {
        let rule = Self.rule("rent", next: "2027-01-31", anchor: 31)
        #expect(
            rule.upcomingDates(4).map(\.description) == ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"])
        let leap = Self.rule("rent", next: "2028-01-31", anchor: 31)
        #expect(leap.upcomingDates(2).map(\.description) == ["2028-01-31", "2028-02-29"])
        let yearly = Self.rule("renewal", next: "2028-02-29", anchor: 29, frequency: .yearly)
        #expect(
            yearly.upcomingDates(3).map(\.description) == ["2028-02-29", "2029-02-28", "2030-02-28"])
        let weekly = Self.rule("gym", next: "2026-11-30", anchor: 30, frequency: .weekly)
        #expect(weekly.upcomingDates(2).map(\.description) == ["2026-11-30", "2026-12-07"])
    }

    @Test("whenTheLedgerRangeEnds_UpcomingDates_ShouldStopAt2100")
    func rangeEnd() {
        let rule = Self.rule("late", next: "2100-11-30", anchor: 30)
        #expect(rule.upcomingDates(3).map(\.description) == ["2100-11-30", "2100-12-30"])
    }
}
