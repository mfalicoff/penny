import Foundation
import PennyContracts
import PennyDomain
import Testing

/// MAZ-290: recurring suggestions, dismissals and accepting one, against the TypeScript rules
/// (`apps/web/src/domain/suggestions.ts`) through contracts/fixtures/recurring-suggestions.json.
@Suite("Recurring suggestions")
struct RecurringSuggestionsTests {
    static func fixture() throws -> RecurringSuggestionsFixture {
        try Fixtures.decode(RecurringSuggestionsFixture.self, from: "recurring-suggestions.json")
    }

    static func suggestion(_ wire: RecurringSuggestionsFixture.Suggestion) throws -> RecurringSuggestion {
        RecurringSuggestion(
            id: wire.id, kind: try ContractLedger.kind(wire.kind), key: wire.key,
            frequency: try #require(RecurrenceFrequency(rawValue: wire.frequency)), title: wire.title,
            total: wire.total, share: wire.share, participants: wire.participants, categoryId: wire.categoryId,
            accountId: wire.accountId, previousShare: wire.previousShare, anchorDay: wire.anchorDay,
            nextDate: try ContractLedger.date(wire.nextDate), count: wire.count,
            firstDate: try ContractLedger.date(wire.firstDate), lastDate: try ContractLedger.date(wire.lastDate),
            entryIds: wire.entryIds)
    }

    @Test("whenGoldenTitle_Key_ShouldMatchRecurringSuggestionsFixture")
    func goldenKeys() throws {
        let fixture = try Self.fixture()
        #expect(fixture.keys.count >= 5)
        for item in fixture.keys {
            #expect(RecurringSuggestions.key(item.title) == item.key, "\(item.title)")
        }
    }

    @Test("whenGoldenCase_Suggestions_ShouldMatchRecurringSuggestionsFixture")
    func goldenCases() throws {
        let fixture = try Self.fixture()
        #expect(fixture.cases.count >= 15)
        for item in fixture.cases {
            let ledger = try ContractLedger.ledger(item.ledger)
            let found = RecurringSuggestions.suggestions(ledger, today: try ContractLedger.date(item.today))
            #expect(found == (try item.expected.map(Self.suggestion)), "\(item.name)")
        }
    }

    @Test("whenGoldenCaseIsDismissed_Suggestions_ShouldHideItUntilTheAmountMoves")
    func dismissingEveryGoldenSuggestion() throws {
        for item in try Self.fixture().cases {
            let today = try ContractLedger.date(item.today)
            let ledger = try ContractLedger.ledger(item.ledger)
            for suggestion in RecurringSuggestions.suggestions(ledger, today: today) {
                let dismissed = try LedgerChange.dismissSuggestion(suggestion).apply(to: ledger)
                #expect(dismissed.dismissedSuggestions?.last == "\(suggestion.id)|\(suggestion.share)")
                #expect(!RecurringSuggestions.suggestions(dismissed, today: today).contains { $0.id == suggestion.id })
                let undone = try LedgerChange.undoDismissSuggestion(suggestion).apply(to: dismissed)
                #expect(RecurringSuggestions.suggestions(undone, today: today).contains(suggestion), "\(item.name)")
            }
        }
    }

    @Test("whenAmountMovesAroundADismissal_IsDismissed_ShouldHoldWithin25Percent")
    func dismissalTolerance() {
        let suggestion = RecurringSuggestion(
            id: "expense|netflix|monthly", kind: .expense, key: "netflix", frequency: .monthly, title: "Netflix",
            total: 1250, share: 1250, categoryId: "fun", anchorDay: 3, nextDate: .day("2026-12-03"), count: 4,
            firstDate: .day("2026-08-03"), lastDate: .day("2026-11-03"), entryIds: [])
        #expect(RecurringSuggestions.isDismissed(suggestion, by: ["expense|netflix|monthly|1000"]))
        #expect(!RecurringSuggestions.isDismissed(suggestion, by: ["expense|netflix|monthly|999"]))
        #expect(!RecurringSuggestions.isDismissed(suggestion, by: ["expense|netflix|weekly|1250"]))
        // Malformed amounts never hide anything.
        for item in [
            "expense|netflix|monthly|", "expense|netflix|monthly|12a", "expense|netflix|monthly|-1250",
            "expense|netflix|monthly|٣", "expense|netflix|monthly|000000001250", "expense|netflix|monthly",
        ] {
            #expect(!RecurringSuggestions.isDismissed(suggestion, by: [item]), "\(item)")
        }
    }

    @Test("whenDismissedTwiceOrPastTheLimit_DismissSuggestion_ShouldKeepTheNewest500Once")
    func dismissalLimit() throws {
        let suggestion = try #require(try netflix())
        var ledger = Sample.ledger()
        ledger.dismissedSuggestions = (0..<500).map { "expense|old \($0)|monthly|100" }
        let dismissed = try LedgerChange.dismissSuggestion(suggestion).apply(to: ledger)
        #expect(dismissed.dismissedSuggestions?.count == 500)
        #expect(dismissed.dismissedSuggestions?.first == "expense|old 1|monthly|100")
        #expect(dismissed.dismissedSuggestions?.last == suggestion.dismissal)
        let again = try LedgerChange.dismissSuggestion(suggestion).apply(to: dismissed)
        #expect(again.dismissedSuggestions == dismissed.dismissedSuggestions)
        #expect(again.violations.isEmpty)
    }

    @Test("whenNothingWasDismissed_UndoDismissSuggestion_ShouldLeaveTheFieldAbsent")
    func undoWithoutDismissal() throws {
        let suggestion = try #require(try netflix())
        let ledger = Sample.ledger()
        #expect(try LedgerChange.undoDismissSuggestion(suggestion).apply(to: ledger) == ledger)
        let dismissed = try LedgerChange.dismissSuggestion(suggestion).apply(to: ledger)
        // Undoing the only dismissal leaves an empty list: the merge then knows this device undid it.
        #expect(try LedgerChange.undoDismissSuggestion(suggestion).apply(to: dismissed).dismissedSuggestions == [])
    }

    @Test("whenSuggestionIsAccepted_AcceptSuggestion_ShouldAddOneRuleAndRecordNoDateTwice")
    func accept() throws {
        let item = try #require(
            try Self.fixture().cases.first { $0.name.hasPrefix("monthly expense after a price step") })
        let ledger = try ContractLedger.ledger(item.ledger)
        let today = try ContractLedger.date(item.today)
        let suggestion = try #require(RecurringSuggestions.suggestions(ledger, today: today).first)
        let rule = RecurringSuggestions.rule(for: suggestion, id: "rule-netflix")
        #expect(rule.date == .day("2026-12-03"))
        #expect(rule.nextDate == .day("2026-12-03"))
        #expect(rule.anchorDay == 3)
        #expect(rule.share == 1699 && rule.total == 1699)
        #expect(rule.categoryId == "fun" && rule.accountId == "chq" && rule.note == "" && rule.active)
        let accepted = try LedgerChange.acceptSuggestion(rule).apply(to: ledger)
        #expect(accepted.recurring == ledger.recurring + [rule])
        #expect(accepted.transactions == ledger.transactions)
        #expect(accepted.violations.isEmpty)
        // Re-applied after a sync: still one rule.
        #expect(try LedgerChange.acceptSuggestion(rule).apply(to: accepted) == accepted)
        // The schedule now covers the group, so the suggestion is gone.
        #expect(RecurringSuggestions.suggestions(accepted, today: today).isEmpty)
        // Catching up today records nothing; on the next date it records one new entry.
        #expect(Recurrence.materialize(accepted, today: today) == accepted)
        let december = Recurrence.materialize(accepted, today: .day("2026-12-03"))
        let recorded = december.transactions.filter { $0.recurringId == "rule-netflix" }
        #expect(recorded.map(\.date) == [.day("2026-12-03")])
        let dates = december.transactions.filter { RecurringSuggestions.key($0.title) == "netflix" }.map(\.date)
        #expect(Set(dates).count == dates.count)
    }

    @Test("whenCategoryOrAccountIsGone_AcceptSuggestion_ShouldRefuse")
    func acceptRefused() throws {
        let suggestion = try #require(try netflix())
        var rule = RecurringSuggestions.rule(for: suggestion, id: "rule-netflix")
        rule.accountId = "gone"
        #expect(throws: LedgerRuleError.accountRemoved) {
            try LedgerChange.acceptSuggestion(rule).apply(to: Sample.ledger())
        }
        rule.accountId = nil
        rule.categoryId = "salary"
        #expect(throws: LedgerRuleError.categoryRemoved) {
            try LedgerChange.acceptSuggestion(rule).apply(to: Sample.ledger())
        }
    }

    @Test("whenWeeklyIncomeRepeats_Suggestions_ShouldAnchorOnTheNextDatesDay")
    func weeklyAnchor() throws {
        let entries = (0..<4).map {
            Sample.entry(
                "t\($0)", CalendarDate.day("2026-10-28").adding(days: 7 * $0).description, share: 6000, kind: .income,
                title: "Tutoring")
        }
        let found = RecurringSuggestions.suggestions(Sample.ledger(transactions: entries), today: .day("2026-11-20"))
        let suggestion = try #require(found.first)
        #expect(suggestion.frequency == .weekly)
        #expect(suggestion.nextDate == .day("2026-11-25"))
        #expect(suggestion.anchorDay == 25)
        #expect(suggestion.accountId == nil && suggestion.previousShare == nil && suggestion.participants == nil)
    }

    @Test("whenTitleHasMarksOrOtherScripts_Key_ShouldFoldAndSplitOnNonLetters")
    func keys() {
        #expect(RecurringSuggestions.key("Ｎｅｔｆｌｉｘ") == "ｎｅｔｆｌｉｘ")
        #expect(RecurringSuggestions.key("Crème brûlée—Co.") == "creme brulee")
        // NFD splits ガ into カ and a combining mark, which is dropped (as in the TypeScript).
        #expect(RecurringSuggestions.key("東京 ガス") == "東京 カス")
        #expect(RecurringSuggestions.key("Spotify_Premium 2") == "spotify premium")
    }

    private func netflix() throws -> RecurringSuggestion? {
        let item = try #require(
            try Self.fixture().cases.first { $0.name.hasPrefix("monthly expense after a price step") })
        return RecurringSuggestions.suggestions(
            try ContractLedger.ledger(item.ledger), today: try ContractLedger.date(item.today)
        ).first
    }
}
