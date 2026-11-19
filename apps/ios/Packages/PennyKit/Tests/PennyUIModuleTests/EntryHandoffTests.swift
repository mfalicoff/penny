import PennyData
import PennyDomain
import Testing

@testable import PennyUI

/// Add entry's Household: what was typed moves between the personal form and a household's
/// shared expense, both ways, without losing anything. Synthetic ledger and ids only.
@Suite("Add entry handoff between personal and shared")
@MainActor
struct EntryHandoffTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest
    private let visa = PaymentAccount(id: "visa", name: "Visa", type: .credit)

    private var ledger: Ledger { Ledger(accounts: [visa]) }

    private func personalDraft() -> EntryEditor {
        var editor = EntryEditor(new: .expense, today: today, ledger: ledger)
        editor.draft.amount = "42.5"
        editor.draft.title = "Groceries run"
        editor.draft.date = "2026-11-07"
        editor.draft.categoryId = "home"
        editor.draft.accountId = "visa"
        editor.draft.note = "Split with the flat"
        return editor
    }

    @Test("whenAPersonalExpenseGoesToAHousehold_SharedDraft_ShouldKeepWhatWasTyped")
    func personalToShared() {
        let handoff = EntryHandoff(personalDraft().draft, ledger: ledger)
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        handoff.apply(to: &shared, ledger: ledger)

        #expect(shared.amountText == "42.5")
        #expect(shared.totalCents == 4250)
        #expect(shared.title == "Groceries run")
        #expect(shared.date == CalendarDate("2026-11-07"))
        #expect(shared.category.name == "Home")
        #expect(shared.accountId == "visa")
        #expect(shared.note == "Split with the flat")
        #expect(shared.payerId == "u-me")
    }

    @Test("whenASharedExpenseGoesBackToPersonal_Entry_ShouldKeepWhatWasTyped")
    func sharedToPersonal() {
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        shared.amountText = "18,25"
        shared.title = "Streaming"
        shared.date = CalendarDate("2026-11-03") ?? today
        shared.category = WireSharedCategory(name: "Entertainment", icon: "musical-notes-outline", color: "#9D83BA")
        shared.accountId = "visa"
        shared.note = "Monthly"

        let handoff = EntryHandoff(shared, viewerId: "u-me")
        var editor = EntryEditor(new: .expense, today: today, ledger: ledger)
        handoff.apply(to: &editor, ledger: ledger)

        // A comma typed on an iPad keyboard comes back as the keypad's dot.
        #expect(editor.draft.amount == "18.25")
        #expect(editor.draft.title == "Streaming")
        #expect(editor.draft.date == "2026-11-03")
        #expect(editor.draft.categoryId == "fun")
        #expect(editor.draft.accountId == "visa")
        #expect(editor.draft.note == "Monthly")
        #expect(editor.isDirty)
    }

    @Test("whenSomeoneElsePays_Handoff_ShouldNotCarryAPrivateAccount")
    func otherPayerKeepsNoAccount() {
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        shared.accountId = "visa"
        shared.choosePayer("u-bea", viewerId: "u-me")
        let handoff = EntryHandoff(shared, viewerId: "u-me")
        #expect(handoff.accountId == nil)
    }

    @Test("whenIncomeIsChosenFromTheSharedForm_Entry_ShouldOpenAsIncomeWithAnIncomeCategory")
    func kindChange() {
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        shared.amountText = "900"
        shared.title = "Refund"
        let handoff = EntryHandoff(shared, viewerId: "u-me", kind: .income)
        var editor = EntryEditor(new: .expense, today: today, ledger: ledger)
        handoff.apply(to: &editor, ledger: ledger)

        #expect(editor.draft.kind == .income)
        #expect(editor.draft.amount == "900")
        // "Other" is an expense category, so the income keeps its own default instead.
        #expect(ledger.category(id: editor.draft.categoryId)?.kind == .income)
    }

    @Test("whenTheCategoryOrAccountIsGone_Handoff_ShouldKeepTheFormsOwnDefaults")
    func missingReferences() {
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        shared.category = WireSharedCategory(name: "Not in this ledger", icon: "pricetag", color: "#8E8E93")
        shared.accountId = "closed-card"
        let handoff = EntryHandoff(shared, viewerId: "u-me")
        var editor = EntryEditor(new: .expense, today: today, ledger: ledger)
        let defaultCategory = editor.draft.categoryId
        handoff.apply(to: &editor, ledger: ledger)

        #expect(editor.draft.categoryId == defaultCategory)
        #expect(editor.draft.accountId == nil)
    }

    @Test("whenMoreDetailsListsTrips_EntryScope_ShouldOfferOnlySharedTripsLatestFirst")
    func sharedTrips() {
        func household(_ id: String, _ name: String, start: String?) -> WireHousehold {
            WireHousehold(
                id: id, name: name, currency: "CAD", creatorId: "u-me", createdAt: 0, memberCount: 2,
                trip: start.map { WireHouseholdTrip(startDate: $0, endDate: $0) })
        }
        let scope = EntryScope(
            households: [
                household("h-flat", "Flat", start: nil),
                household("t-lisbon", "Lisbon", start: "2026-10-01"),
                household("t-montreal", "Montréal", start: "2026-12-04"),
                household("t-austin", "Austin", start: "2026-10-01"),
            ],
            current: nil, choose: { _, _ in })

        #expect(scope.sharedTrips.map(\.id) == ["t-montreal", "t-austin", "t-lisbon"])
        #expect(
            EntryScope(households: [household("h-flat", "Flat", start: nil)], current: nil) { _, _ in }
                .sharedTrips.isEmpty)
    }
}
