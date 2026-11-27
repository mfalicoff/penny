import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

/// Recurring suggestions on screen (MAZ-290): the cards' wording, the filled-in form that accepts
/// one, and Dismiss with Undo through `FixedWorkspace`, so a save really applies the ledger rule.
@Suite("Recurring suggestions")
@MainActor
struct RecurringSuggestionViewTests {
    private static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }
    private static let today = day("2026-11-12")
    private static let visa = PaymentAccount(id: "visa", name: "Visa", type: .credit)

    /// The cards' sample: Netflix after a price step and weekly Tutoring income.
    private static func ledger() -> Ledger {
        let netflix = [("2026-08-03", 1549), ("2026-09-03", 1549), ("2026-10-03", 1699), ("2026-11-03", 1699)]
            .enumerated().map { index, item in
                LedgerEntry(
                    id: "netflix-\(index + 1)", title: "Netflix", kind: .expense, total: Int64(item.1),
                    share: Int64(item.1), categoryId: "fun", accountId: "visa", date: day(item.0))
            }
        let tutoring = (0..<6).map { index in
            LedgerEntry(
                id: "tutoring-\(index + 1)", title: "Tutoring", kind: .income, total: 6000, share: 6000,
                categoryId: "salary", date: day("2026-10-07").adding(days: 7 * index))
        }
        return Ledger(accounts: [visa], transactions: netflix + tutoring)
    }

    private static func suggestions() -> [RecurringSuggestion] {
        RecurringSuggestions.suggestions(ledger(), today: today)
    }

    private static func commit(_ workspace: FixedWorkspace) -> LedgerCommit {
        { change, summary in
            if case .failure(let failure) = await workspace.commit(change, summary: summary) { return failure }
            return nil
        }
    }

    @Test("whenTheCardsSampleRepeats_SuggestionText_ShouldReadAsTheCards")
    func wording() throws {
        let found = Self.suggestions()
        let tutoring = try #require(found.first { $0.kind == .income })
        let netflix = try #require(found.first { $0.kind == .expense })
        #expect(found.map(\.id) == ["expense|netflix|monthly", "income|tutoring|weekly"], "the longest-running first")
        #expect(SuggestionText.cadence(netflix) == "Every month, around the 3rd")
        #expect(SuggestionText.cadence(tutoring) == "Every week, on Wednesdays")
        #expect(SuggestionText.seen(netflix, today: Self.today) == "Seen 4 times since Aug 3")
        #expect(SuggestionText.seen(tutoring, today: Self.today) == "Seen 6 times since Oct 7")
        let old = MoneyFormat.amount(1549, currency: "USD")
        #expect(SuggestionText.was(netflix, currency: "USD") == "was \(old)")
        #expect(SuggestionText.was(tutoring, currency: "USD") == nil)
        #expect(SuggestionText.wasUntil(netflix, ledger: Self.ledger(), currency: "USD") == "was \(old) until October")
        #expect(
            SuggestionText.dismissed(netflix, currency: "USD")
                == "Netflix · about \(MoneyFormat.amount(1699, currency: "USD")) every month")
        #expect(SuggestionText.repeats(netflix) == "Monthly on the 3rd")
        var yearly = netflix
        yearly.frequency = .yearly
        yearly.anchorDay = 14
        yearly.nextDate = Self.day("2027-03-14")
        #expect(SuggestionText.cadence(yearly) == "Every year, around March 14")
        #expect(SuggestionText.seen(yearly, today: Self.day("2027-01-02")) == "Seen 4 times since Aug 3, 2026")
    }

    @Test("whenASuggestionsFormIsSaved_ScheduleForm_ShouldAddOneRuleFromTheNextDateAndRecordNothing")
    func accept() async throws {
        let workspace = FixedWorkspace(load: .ready(Self.ledger()))
        let netflix = try #require(Self.suggestions().first { $0.kind == .expense })
        let model = ScheduleFormModel(suggestion: netflix, makeID: { "rule-netflix" })
        #expect(model.isNew && model.title == "New schedule")
        #expect(model.draft.title == "Netflix" && model.draft.amount == "16.99" && model.draft.categoryId == "fun")
        #expect(model.draft.accountId == "visa" && model.draft.frequency == .monthly)
        #expect(model.date == Self.day("2026-12-03"))
        let rule = try #require(await model.save(categories: Ledger.defaultCategories, with: Self.commit(workspace)))
        let ledger = try #require(workspace.load.ledger)
        #expect(rule.id == "rule-netflix" && rule.date == Self.day("2026-12-03") && rule.nextDate == rule.date)
        #expect(rule.anchorDay == 3 && rule.share == 1699)
        #expect(ledger.recurring == [rule])
        #expect(ledger.transactions == Self.ledger().transactions, "past entries stay as they are")
        #expect(workspace.commits.last?.title == "Schedule added")
        #expect(RecurringSuggestions.suggestions(ledger, today: Self.today).map(\.kind) == [.income])
    }

    @Test("whenTheFirstDateMoves_ScheduleForm_ShouldStartAndAnchorTheRuleThere")
    func movedDate() async throws {
        let workspace = FixedWorkspace(load: .ready(Self.ledger()))
        let netflix = try #require(Self.suggestions().first { $0.kind == .expense })
        let model = ScheduleFormModel(suggestion: netflix, makeID: { "rule-netflix" })
        model.date = Self.day("2026-12-05")
        let rule = try #require(await model.save(categories: Ledger.defaultCategories, with: Self.commit(workspace)))
        #expect(rule.date == Self.day("2026-12-05") && rule.nextDate == rule.date && rule.anchorDay == 5)
    }

    @Test("whenAccountIsGone_ScheduleForm_ShouldRefuseAndKeepTheSuggestion")
    func acceptRefused() async throws {
        var ledger = Self.ledger()
        let netflix = try #require(
            RecurringSuggestions.suggestions(ledger, today: Self.today).first { $0.kind == .expense })
        ledger.accounts = []
        ledger.transactions.removeAll { $0.accountId == "visa" }
        let workspace = FixedWorkspace(load: .ready(ledger))
        let model = ScheduleFormModel(suggestion: netflix, makeID: { "rule-netflix" })
        #expect(await model.save(categories: Ledger.defaultCategories, with: Self.commit(workspace)) == nil)
        #expect(model.failure == .rule(.accountRemoved))
        #expect(workspace.load.ledger?.recurring.isEmpty == true)
    }

    @Test("whenASuggestionIsDismissed_Shell_ShouldHideItWithTheToastAndALightHaptic")
    func dismissAndUndo() async throws {
        let workspace = FixedWorkspace(load: .ready(Self.ledger()))
        let shell = ShellModel(workspace: workspace, session: .demo, today: Self.today, startDemo: nil, leaveDemo: {})
        let tutoring = try #require(Self.suggestions().first { $0.kind == .income })
        #expect(await SuggestionActions.dismiss(tutoring, shell: shell) == nil)
        let dismissed = try #require(workspace.load.ledger)
        #expect(dismissed.dismissedSuggestions == ["income|tutoring|weekly|6000"])
        #expect(!RecurringSuggestions.suggestions(dismissed, today: Self.today).contains { $0.id == tutoring.id })
        #expect(shell.toast?.summary.title == "Suggestion dismissed")
        #expect(shell.toast?.summary.detail == SuggestionText.dismissed(tutoring, currency: "CAD"))
        #expect(shell.dismissedSuggestionCount == 1 && shell.savedCount == 0, "a light haptic, not the save one")
    }
}
