import PennyData
import PennyDomain
import Testing

@testable import PennyUI

/// A receipt on a shared expense (MAZ-256, `iphone-shared-expense-add`): attached in Receipt,
/// repeat, note, sent as the expense's `receiptId`, kept when the expense moves between the
/// personal and shared forms. Synthetic ids only.
@Suite("Receipts on shared expenses")
@MainActor
struct SharedReceiptTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest
    private let receipt = ReceiptReference(id: "r-1", name: "hydro.jpg", uri: "/api/receipts/r-1", mime: "image/jpeg")
    private let members = [
        WireHouseholdMember(userId: "u-me", email: "me@example.test", joinedAt: 0),
        WireHouseholdMember(userId: "u-bea", email: "bea@example.test", joinedAt: 0),
    ]

    private func newDraft() -> SharedExpenseDraft {
        var draft = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        draft.amountText = "96.30"
        draft.title = "Hydro"
        return draft
    }

    private func input(_ draft: SharedExpenseDraft) throws -> WireExpenseInput {
        let valid = try draft.validate(participants: members).get()
        return draft.expenseInput(valid, viewerId: "u-me", timezoneOffset: 0)
    }

    private func expense(receiptId: String?, receipt: WireReceipt?) -> WireSharedExpense {
        WireSharedExpense(
            id: "e-1", householdId: "h-1", title: "Hydro", totalCents: 9630, date: "2026-11-04", payerUserId: "u-me",
            splitMode: "equal",
            splits: [WireSplit(userId: "u-me", amountCents: 4815), WireSplit(userId: "u-bea", amountCents: 4815)],
            category: .other, receiptId: receiptId, receipt: receipt, revision: 2, createdBy: "u-me", createdAt: 0,
            updatedBy: "u-me", updatedAt: 0)
    }

    @Test("whenANewSharedExpenseHasAReceipt_Input_ShouldSendItsId")
    func newExpenseSendsReceipt() throws {
        var draft = newDraft()
        #expect(try input(draft).receiptId == nil)
        draft.receipt = receipt
        #expect(try input(draft).receiptId == "r-1")
    }

    @Test("whenAnEditedExpenseHasAReceipt_Draft_ShouldKeepItUntilRemoved")
    func editKeepsAndRemoves() throws {
        let stored = WireReceipt(id: "r-9", name: "bill.pdf", mime: "application/pdf", uri: "/api/receipts/r-9")
        var draft = SharedExpenseDraft(editing: expense(receiptId: "r-9", receipt: stored), viewerId: "u-me")
        #expect(draft.receipt?.name == "bill.pdf")
        #expect(try input(draft).receiptId == "r-9")
        draft.receipt = nil
        #expect(try input(draft).receiptId == nil)
    }

    @Test("whenOnlyTheReceiptIdIsKnown_Draft_ShouldStillKeepTheLink")
    func idOnlyIsKept() throws {
        let draft = SharedExpenseDraft(editing: expense(receiptId: "r-3", receipt: nil), viewerId: "u-me")
        #expect(try input(draft).receiptId == "r-3")
    }

    @Test("whenAnExpenseMovesBetweenForms_Handoff_ShouldCarryTheReceipt")
    func handoffCarriesReceipt() {
        var editor = EntryEditor(new: .expense, today: today, ledger: Ledger())
        editor.draft.receipt = receipt
        var shared = SharedExpenseDraft(householdId: "h-1", payerId: "u-me", today: today, category: .other)
        EntryHandoff(editor.draft, ledger: Ledger()).apply(to: &shared, ledger: Ledger())
        #expect(shared.receipt == receipt)

        var back = EntryEditor(new: .expense, today: today, ledger: Ledger())
        EntryHandoff(shared, viewerId: "u-me").apply(to: &back, ledger: Ledger())
        #expect(back.draft.receipt == receipt)

        var income = EntryEditor(new: .expense, today: today, ledger: Ledger())
        EntryHandoff(shared, viewerId: "u-me", kind: .income).apply(to: &income, ledger: Ledger())
        #expect(income.draft.receipt == nil, "income has no receipt")
    }

    @Test("whenTheFormIsNewEditedOrARule_DetailsRow_ShouldNameWhatItHolds")
    func detailsTitle() {
        var draft = newDraft()
        #expect(SharedFormText.detailsTitle(draft) == "Receipt, repeat, note")
        draft = SharedExpenseDraft(editing: expense(receiptId: nil, receipt: nil), viewerId: "u-me")
        #expect(SharedFormText.detailsTitle(draft) == "Receipt, note")
        let rule = WireSharedRule(
            id: "r", householdId: "h-1", title: "Rent", totalCents: 100, payerUserId: "u-me", splitMode: "equal",
            category: .other, frequency: "monthly", nextDate: "2026-12-01")
        #expect(SharedFormText.detailsTitle(SharedExpenseDraft(editing: rule, viewerId: "u-me")) == "Repeat, note")
    }
}
