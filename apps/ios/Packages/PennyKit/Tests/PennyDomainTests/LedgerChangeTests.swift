import PennyDomain
import Testing

@Suite("Ledger changes")
struct LedgerChangeTests {
    static let coffee = Sample.entry("c1", "2026-11-03", share: 500, total: 1000, accountId: "visa", tripId: "lisbon")

    @Test("whenEntryIsNew_SaveEntry_ShouldAppendItAndItsRule")
    func saveNewEntry() throws {
        let rule = Sample.rule("r1", start: "2026-11-03", next: "2026-12-03")
        let ledger = Sample.ledger()
        let saved = try LedgerChange.saveEntry(Self.coffee, rule: rule).apply(to: ledger)
        #expect(saved.transactions == [Self.coffee])
        #expect(saved.recurring == [rule])
        #expect(ledger.transactions.isEmpty, "the input ledger is a value and never changes")
    }

    @Test("whenEntryIsEdited_SaveEntry_ShouldReplaceItAndMoveItLast")
    func saveEditedEntry() throws {
        let other = Sample.entry("c0", "2026-11-01")
        let ledger = Sample.ledger(transactions: [Self.coffee, other])
        var edited = Self.coffee
        edited.title = "Espresso"
        edited.accountId = nil  // clearing a field removes it
        let saved = try LedgerChange.saveEntry(edited, original: Self.coffee).apply(to: ledger)
        #expect(saved.transactions == [other, edited])
        #expect(saved.entry(id: "c1")?.accountId == nil)
    }

    @Test(
        "whenAReferenceIsGone_SaveEntry_ShouldRefuseWithTheNextStep",
        arguments: [
            (Sample.entry("x", "2026-11-03", accountId: "gone"), LedgerRuleError.accountRemoved),
            (Sample.entry("x", "2026-11-03", tripId: "gone"), .tripUnavailable),
            (Sample.entry("x", "2026-11-03", kind: .income, tripId: "lisbon"), .tripUnavailable),
            (Sample.entry("x", "2026-11-03", category: "gone"), .categoryRemoved),
            (Sample.entry("x", "2026-11-03", kind: .income, category: "food"), .categoryRemoved),
        ])
    func invalidReferences(entry: LedgerEntry, error: LedgerRuleError) {
        let ledger = Sample.ledger()
        #expect(throws: error) { try LedgerChange.saveEntry(entry).apply(to: ledger) }
    }

    @Test("whenRuleAccountIsGone_SaveEntry_ShouldRefuse")
    func ruleAccountGone() {
        let rule = Sample.rule("r", start: "2026-11-03", accountId: "gone")
        #expect(throws: LedgerRuleError.accountRemoved) {
            try LedgerChange.saveEntry(Sample.entry("x", "2026-11-03"), rule: rule).apply(to: Sample.ledger())
        }
    }

    @Test("whenEntryChangedOrVanishedElsewhere_SaveAndDelete_ShouldRefuseAsStale")
    func staleEntry() {
        var remote = Self.coffee
        remote.share = 600
        let ledger = Sample.ledger(transactions: [remote])
        #expect(throws: LedgerRuleError.entryChangedOnAnotherDevice) {
            try LedgerChange.saveEntry(Self.coffee, original: Self.coffee).apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.entryChangedBeforeDelete) {
            try LedgerChange.deleteEntry(Self.coffee).apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.entryChangedBeforeDelete) {
            try LedgerChange.deleteEntry(Self.coffee).apply(to: Sample.ledger())
        }
    }

    @Test("whenEntryIsUnchanged_DeleteEntry_ShouldRemoveOnlyIt")
    func deleteEntry() throws {
        let other = Sample.entry("c0", "2026-11-01")
        let saved = try LedgerChange.deleteEntry(Self.coffee).apply(
            to: Sample.ledger(transactions: [Self.coffee, other]))
        #expect(saved.transactions == [other])
    }

    @Test("whenScheduleIsEdited_SaveSchedule_ShouldKeepRecordedHistory")
    func historicalEdits() throws {
        let rule = Sample.rule("rent", start: "2026-01-01", next: "2026-03-01")
        let recorded = [
            Recurrence.occurrence(of: rule, on: .day("2026-01-01")),
            Recurrence.occurrence(of: rule, on: .day("2026-02-01")),
        ]
        var raised = rule
        raised.total = 5000
        raised.share = 5000
        raised.accountId = "visa"
        let saved = try LedgerChange.saveSchedule(raised, original: rule).apply(
            to: Sample.ledger(transactions: recorded, recurring: [rule]))
        #expect(saved.transactions == recorded, "past occurrences keep the old amount")
        let next = Recurrence.materialize(saved, today: .day("2026-03-01"))
        #expect(next.entry(id: "rent:2026-03-01")?.share == 5000)
        #expect(next.entry(id: "rent:2026-03-01")?.accountId == "visa")
    }

    @Test("whenScheduleIsStaleOrInvalid_SaveSchedule_ShouldRefuse")
    func scheduleRefused() {
        let rule = Sample.rule("rent", start: "2026-01-01")
        var moved = rule
        moved.nextDate = .day("2026-05-01")
        let ledger = Sample.ledger(recurring: [moved])
        #expect(throws: LedgerRuleError.scheduleChangedOnAnotherDevice) {
            try LedgerChange.saveSchedule(rule, original: rule).apply(to: ledger)
        }
        var badAccount = moved
        badAccount.accountId = "gone"
        #expect(throws: LedgerRuleError.accountRemoved) {
            try LedgerChange.saveSchedule(badAccount, original: moved).apply(to: ledger)
        }
        var badCategory = moved
        badCategory.categoryId = "salary"
        #expect(throws: LedgerRuleError.categoryRemoved) {
            try LedgerChange.saveSchedule(badCategory, original: moved).apply(to: ledger)
        }
    }

    @Test("whenPausedThenResumed_SetScheduleActive_ShouldSkipThePausedDates")
    func pauseResume() throws {
        let rule = Sample.rule("gym", start: "2026-01-31", next: "2026-02-28", anchorDay: 31)
        let ledger = Sample.ledger(recurring: [rule])
        let paused = try LedgerChange.setScheduleActive(id: "gym", active: false, today: .day("2026-02-01"))
            .apply(to: ledger)
        #expect(paused.recurring[0].active == false)
        #expect(paused.recurring[0].nextDate == .day("2026-02-28"))
        #expect(Recurrence.materialize(paused, today: .day("2026-05-31")).transactions.isEmpty)
        let resumed = try LedgerChange.setScheduleActive(id: "gym", active: true, today: .day("2026-05-31"))
            .apply(to: paused)
        // Feb 28 through May 31 were paused; the anchor survives the short months.
        #expect(resumed.recurring[0].nextDate == .day("2026-06-30"))
        #expect(Recurrence.materialize(resumed, today: .day("2026-05-31")).transactions.isEmpty)
        // Resuming an active rule, or an unknown id, keeps nextDate.
        #expect(
            try LedgerChange.setScheduleActive(id: "gym", active: true, today: .day("2027-01-01")).apply(to: ledger)
                == ledger)
        #expect(
            try LedgerChange.setScheduleActive(id: "nope", active: false, today: .day("2027-01-01")).apply(to: ledger)
                == ledger)
    }

    @Test("whenScheduleIsRemoved_RemoveSchedule_ShouldKeepItsHistory")
    func removeSchedule() throws {
        let rule = Sample.rule("rent", start: "2026-01-01", next: "2026-02-01")
        let recorded = Recurrence.occurrence(of: rule, on: .day("2026-01-01"))
        let saved = try LedgerChange.removeSchedule(id: "rent").apply(
            to: Sample.ledger(transactions: [recorded], recurring: [rule]))
        #expect(saved.recurring.isEmpty)
        #expect(saved.transactions == [recorded])
        #expect(saved.violations.isEmpty, "a dangling recurringId is valid history")
    }

    @Test("whenTripIsAddedEditedOrRemoved_SaveTrip_ShouldApplyTheTripRules")
    func trips() throws {
        let ledger = Sample.ledger()
        let porto = Trip(
            id: "porto", name: "  Porto\u{FEFF} ", startDate: .day("2026-12-01"), endDate: .day("2026-12-01"))
        let added = try LedgerChange.saveTrip(porto).apply(to: ledger)
        #expect(added.trips.last?.name == "Porto")
        #expect(throws: LedgerRuleError.duplicateTripName) {
            try LedgerChange.saveTrip(
                Trip(id: "x", name: "LISBON", startDate: .day("2026-01-01"), endDate: .day("2026-01-02"))
            )
            .apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidTripName) {
            try LedgerChange.saveTrip(
                Trip(id: "x", name: " \t ", startDate: .day("2026-01-01"), endDate: .day("2026-01-02"))
            )
            .apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidTripName) {
            try LedgerChange.saveTrip(
                Trip(
                    id: "x", name: String(repeating: "é", count: 81), startDate: .day("2026-01-01"),
                    endDate: .day("2026-01-02"))
            ).apply(to: ledger)
        }
        // 40 emoji are 80 UTF-16 code units: allowed. 41 are 82: refused.
        #expect(throws: Never.self) {
            try LedgerChange.saveTrip(
                Trip(
                    id: "x", name: String(repeating: "🎉", count: 40), startDate: .day("2026-01-01"),
                    endDate: .day("2026-01-02"))
            ).apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidTripName) {
            try LedgerChange.saveTrip(
                Trip(
                    id: "x", name: String(repeating: "🎉", count: 41), startDate: .day("2026-01-01"),
                    endDate: .day("2026-01-02"))
            ).apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidTripDates) {
            try LedgerChange.saveTrip(
                Trip(id: "x", name: "Back", startDate: .day("2026-01-02"), endDate: .day("2026-01-01"))
            )
            .apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidTripDates) {
            try LedgerChange.saveTrip(
                Trip(id: "x", name: "Old", startDate: .day("1999-12-31"), endDate: .day("2000-01-01"))
            )
            .apply(to: ledger)
        }
        let inUse = Sample.ledger(transactions: [Self.coffee])
        #expect(throws: LedgerRuleError.tripHasEntries) {
            try LedgerChange.saveTrip(Sample.lisbon, remove: true).apply(to: inUse)
        }
        #expect(try LedgerChange.saveTrip(Sample.lisbon, remove: true).apply(to: ledger).trips.isEmpty)
        var renamed = Sample.lisbon
        renamed.name = "Lisboa"
        #expect(try LedgerChange.saveTrip(renamed, original: Sample.lisbon).apply(to: ledger).trips == [renamed])
        #expect(throws: LedgerRuleError.tripChangedOnAnotherDevice) {
            try LedgerChange.saveTrip(renamed, original: renamed).apply(to: ledger)
        }
        var full = ledger
        full.trips = (0..<300).map {
            Trip(id: "t\($0)", name: "Trip \($0)", startDate: .day("2026-01-01"), endDate: .day("2026-01-01"))
        }
        #expect(throws: LedgerRuleError.tooManyTrips) { try LedgerChange.saveTrip(porto).apply(to: full) }
    }

    @Test("whenAccountIsAddedEditedOrRemoved_SaveAccount_ShouldApplyTheAccountRules")
    func accounts() throws {
        let ledger = Sample.ledger()
        let cash = PaymentAccount(id: "cash", name: " Wallet ", type: .cash)
        #expect(try LedgerChange.saveAccount(cash).apply(to: ledger).accounts.last?.name == "Wallet")
        #expect(throws: LedgerRuleError.duplicateAccountName) {
            try LedgerChange.saveAccount(PaymentAccount(id: "x", name: "visa", type: .bank)).apply(to: ledger)
        }
        #expect(throws: LedgerRuleError.invalidAccountName) {
            try LedgerChange.saveAccount(PaymentAccount(id: "x", name: String(repeating: "a", count: 51), type: .bank))
                .apply(to: ledger)
        }
        let usedByRule = Sample.ledger(recurring: [Sample.rule("r", start: "2026-01-01", accountId: "visa")])
        #expect(throws: LedgerRuleError.accountHasEntries) {
            try LedgerChange.saveAccount(Sample.visa, remove: true).apply(to: usedByRule)
        }
        #expect(throws: LedgerRuleError.accountHasEntries) {
            try LedgerChange.saveAccount(Sample.visa, remove: true).apply(
                to: Sample.ledger(transactions: [Self.coffee]))
        }
        #expect(try LedgerChange.saveAccount(Sample.visa, remove: true).apply(to: ledger).accounts.isEmpty)
        var stale = Sample.visa
        stale.name = "Old"
        #expect(throws: LedgerRuleError.accountChangedOnAnotherDevice) {
            try LedgerChange.saveAccount(Sample.visa, original: stale).apply(to: ledger)
        }
        var full = ledger
        full.accounts = (0..<300).map { PaymentAccount(id: "a\($0)", name: "Account \($0)", type: .other) }
        #expect(throws: LedgerRuleError.tooManyAccounts) { try LedgerChange.saveAccount(cash).apply(to: full) }
    }

    @Test("whenCategoryIsAddedEditedOrRemoved_SaveCategory_ShouldApplyTheRules")
    func categories() throws {
        let ledger = Sample.ledger(transactions: [Self.coffee])
        let travel = LedgerCategory(id: "travel", name: " Travel ", icon: "airplane", color: "#E47850", kind: .expense)
        #expect(try LedgerChange.saveCategory(travel).apply(to: ledger).categories.last?.name == "Travel")
        // Same name in another kind is fine; within a kind it is a duplicate.
        let salaryExpense = LedgerCategory(id: "x", name: "SALARY", icon: "i", color: "#E47850", kind: .expense)
        #expect(throws: Never.self) { try LedgerChange.saveCategory(salaryExpense).apply(to: ledger) }
        var duplicate = salaryExpense
        duplicate.kind = .income
        #expect(throws: LedgerRuleError.duplicateCategoryName) {
            try LedgerChange.saveCategory(duplicate).apply(to: ledger)
        }
        var blank = travel
        blank.name = "  "
        #expect(throws: LedgerRuleError.invalidCategoryName) { try LedgerChange.saveCategory(blank).apply(to: ledger) }
        let food = try #require(ledger.category(id: "food"))
        #expect(throws: LedgerRuleError.categoryHasEntries) {
            try LedgerChange.saveCategory(food, original: food, remove: true).apply(to: ledger)
        }
        var reclassified = food
        reclassified.kind = .investment
        #expect(throws: LedgerRuleError.categoryKindInUse) {
            try LedgerChange.saveCategory(reclassified, original: food).apply(to: ledger)
        }
        var renamed = food
        renamed.name = "Groceries & dining"
        let saved = try LedgerChange.saveCategory(renamed, original: food).apply(to: ledger)
        #expect(saved.category(id: "food")?.name == "Groceries & dining")
        #expect(throws: LedgerRuleError.categoryChangedOnAnotherDevice) {
            try LedgerChange.saveCategory(renamed, original: renamed).apply(to: ledger)
        }
        var full = ledger
        full.categories = (0..<300).map {
            LedgerCategory(id: "c\($0)", name: "C\($0)", icon: "i", color: "#E47850", kind: .expense)
        }
        #expect(throws: LedgerRuleError.tooManyCategories) { try LedgerChange.saveCategory(travel).apply(to: full) }
    }

    @Test("whenLedgerHasEntriesOrRules_ChangeCurrency_ShouldRefuse")
    func currency() throws {
        #expect(try LedgerChange.changeCurrency(.eur).apply(to: Sample.ledger()).currency == .eur)
        #expect(throws: LedgerRuleError.currencyLocked) {
            try LedgerChange.changeCurrency(.eur).apply(to: Sample.ledger(transactions: [Self.coffee]))
        }
        #expect(throws: LedgerRuleError.currencyLocked) {
            try LedgerChange.changeCurrency(.eur).apply(
                to: Sample.ledger(recurring: [Sample.rule("r", start: "2026-01-01")]))
        }
    }

    /// The exact shared sentence for every case, as in `src/domain/ledger.ts`
    /// (`cents`, `personalShare`), `src/domain/commands.ts` and
    /// `src/domain/entryDraft.ts`. The switch is exhaustive, so a new case cannot be
    /// added without its sentence here.
    static func sharedMessage(_ error: LedgerRuleError) -> String {
        switch error {
        case .invalidAmount: "Enter an amount with up to two decimal places."
        case .invalidSplitPeople: "Split between 2 and 100 people."
        case .invalidPercentage: "Your percentage must be between 0 and 100."
        case .shareExceedsTotal: "Your share cannot exceed the receipt total."
        case .zeroAmount: "Enter an amount greater than zero."
        case .invalidDate: "Use a valid date between 2000 and 2100, in YYYY-MM-DD format."
        case .missingTitle: "Add a name for this entry."
        case .chooseCategory: "Choose a category."
        case .chooseRepeat: "Choose a repeat schedule."
        case .entryChangedOnAnotherDevice:
            "This entry changed on another device. Close this form and reopen the entry to review the latest version."
        case .entryChangedBeforeDelete: "This entry changed on another device. Reopen it before deleting."
        case .scheduleChangedOnAnotherDevice:
            "This schedule changed on another device. Close this form and reopen it to review the latest version."
        case .tripChangedOnAnotherDevice: "This trip changed on another device. Reopen it before editing."
        case .accountChangedOnAnotherDevice: "This account changed on another device. Reopen it before editing."
        case .categoryChangedOnAnotherDevice: "This category changed on another device. Reopen it before editing."
        case .accountRemoved: "This payment account was removed on another device. Choose another account."
        case .categoryRemoved: "This category was removed on another device. Choose another category."
        case .tripUnavailable: "This trip is no longer available. Choose another trip."
        case .tripHasEntries: "This trip has expenses. Reassign them before deleting it."
        case .categoryHasEntries: "This category has entries. Keep it to preserve your history."
        case .accountHasEntries: "This account has entries or schedules. Reassign them before deleting it."
        case .invalidTripName: "Give your trip a name of up to 80 characters."
        case .invalidTripDates: "Choose valid trip dates, with the end on or after the start."
        case .duplicateTripName: "You already have a trip with this name."
        case .tooManyTrips: "You can add up to 300 trips."
        case .invalidAccountName: "Give your account a name of up to 50 characters."
        case .duplicateAccountName: "You already have an account with this name."
        case .tooManyAccounts: "You can add up to 300 accounts."
        case .duplicateCategoryName: "You already have a category with this name."
        case .currencyLocked: "Currency can only be changed before adding entries."
        // src/domain has no sentence for these four (LedgerRuleError's doc comment); they are
        // pinned to the wording chosen in docs/ios-ledger-domain.md.
        case .invalidCategoryName: "Give your category a name of up to 50 characters."
        case .tooManyCategories: "You can add up to 300 categories."
        case .categoryKindInUse: "This category has entries. Keep its type to preserve your history."
        case .scheduleAfterLedgerRange:
            "This schedule would repeat after 2100. Choose an earlier date, or choose Does not repeat."
        }
    }

    @Test("whenEveryErrorCase_Message_ShouldBeTheSharedSentenceWordForWord")
    func messages() {
        let all: [LedgerRuleError] = [
            .invalidAmount, .invalidSplitPeople, .invalidPercentage, .shareExceedsTotal, .zeroAmount, .invalidDate,
            .missingTitle, .chooseCategory, .chooseRepeat, .scheduleAfterLedgerRange, .entryChangedOnAnotherDevice,
            .entryChangedBeforeDelete, .scheduleChangedOnAnotherDevice, .tripChangedOnAnotherDevice,
            .accountChangedOnAnotherDevice, .categoryChangedOnAnotherDevice, .accountRemoved, .categoryRemoved,
            .tripUnavailable, .tripHasEntries, .categoryHasEntries, .accountHasEntries, .invalidTripName,
            .invalidTripDates, .duplicateTripName, .tooManyTrips, .invalidAccountName, .duplicateAccountName,
            .tooManyAccounts, .invalidCategoryName, .duplicateCategoryName, .tooManyCategories, .categoryKindInUse,
            .currencyLocked,
        ]
        for error in all {
            #expect(error.message == Self.sharedMessage(error), "\(error)")
            #expect(error.description == error.message)
        }
        #expect(Set(all.map(\.message)).count == all.count)
    }
}
