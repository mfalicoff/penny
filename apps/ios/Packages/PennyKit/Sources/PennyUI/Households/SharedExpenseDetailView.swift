import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// One shared expense (the redesign's `shared-expense-detail`, `penny://households/<id>/expenses/<id>`):
/// the original total, who paid, the viewer's share, every member's share with its status and
/// Mark as paid, and the expense's change history. Edit and Delete (for everyone) follow the
/// server's rules: a repaid expense keeps its total, payer, month and shares and can't be deleted.
struct HouseholdExpenseView: View {
    @Environment(ShellModel.self) private var shell
    let householdID: String
    let expenseID: String

    var body: some View {
        Group {
            if let model = shell.households.model(for: householdID) {
                ExpensePage(model: model, expenseID: expenseID)
            } else {
                PennyStateView(.unavailable, title: "Shared expense", message: "Shared expenses need your account.")
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Expense")
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.householdExpense")
    }
}

private struct ExpensePage: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: HouseholdModel
    let expenseID: String

    @State private var expense: WireSharedExpense?
    @State private var failure: HouseholdFailure?
    @State private var events: [WireAuditEvent] = []
    @State private var form: SharedFormRequest?
    @State private var payment: PaymentRequest?
    @State private var confirmingDelete = false

    var body: some View {
        List {
            if let expense {
                summary(expense)
                shares(expense)
                actions(expense)
                history
            }
        }
        .insetGroupedList()
        .overlay {
            if expense == nil {
                if let failure {
                    PennyStateView(
                        failure.kind == .offline ? .offline : .error,
                        title: failure.kind == .gone ? "Expense not found" : "Couldn't open the expense",
                        message: failure.kind == .gone
                            ? "It was deleted, or you don't have a share in it." : failure.message,
                        actionTitle: failure.canRetry ? "Try again" : nil, action: { Task { await load() } })
                } else {
                    PennyStateView(.loading, title: "Opening the expense…")
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: model.writeCount) { Task { await load() } }
        .navigationTitle(expense?.title ?? "Expense")
        .sheet(item: $form) { request in
            SharedExpenseFormSheet(request: request, model: model).environment(shell)
        }
        .sheet(item: $payment, onDismiss: { Task { await load() } }) { request in
            PaymentSheet(request: request, model: model)
        }
        .confirmationDialog(
            "Delete \(expense?.title ?? "this expense") for everyone?", isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete for everyone", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It leaves everyone's balances and spending. The change history keeps a record.")
        }
    }

    private func load() async {
        if model.detail == nil { await model.refresh() }
        switch await model.loadExpense(expenseID) {
        case .success(let loaded):
            expense = loaded
            failure = nil
        case .failure(let refused):
            failure = refused
            if refused.kind == .gone { expense = nil }
        }
        if case .success(let loaded) = await model.history(expenseId: expenseID) { events = loaded }
    }

    private func delete() async {
        guard let expense else { return }
        if let refused = await model.deleteExpense(expense) {
            failure = refused
        } else {
            dismiss()
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func summary(_ expense: WireSharedExpense) -> some View {
        let people = model.people
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HeroAmount("Total", cents: expense.totalCents, currency: model.currency)
                    .accessibilityIdentifier("sharedExpense.total")
                Text(
                    "\(HouseholdText.day(expense.date)) · \(people.name(expense.payerUserId)) paid · split "
                        + expense.mode.label.lowercased()
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            .listRowBackground(Color.clear)
            if let failure {
                HouseholdFailureBanner(failure: failure) { Task { await load() } }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            if let reason = model.readOnlyReason {
                StatusBanner(tone: .info, title: "Read only", message: reason)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
        }
        .listSectionSeparator(.hidden)
        Section {
            LabeledContent("Your share") {
                MoneyText(expense.share(of: people.meId), meaning: .expense, currency: model.currency)
            }
            .accessibilityIdentifier("sharedExpense.yourShare")
            LabeledContent("Category") {
                Label(expense.category.name, systemImage: expense.category.symbol)
            }
            if !expense.note.isEmpty { LabeledContent("Note", value: expense.note) }
            if expense.payerUserId == people.meId, let accountId = expense.accountId {
                LabeledContent("Paid with", value: account(accountId))
            }
            if expense.receipt != nil || expense.receiptId != nil {
                LabeledContent("Receipt", value: expense.receipt?.name ?? "Attached")
            }
        } footer: {
            Text(
                expense.payerUserId == people.meId && expense.accountId != nil
                    ? "Only you see which account you paid with. Your share counts in your spending."
                    : "Your share counts in your spending; the rest belongs to the others.")
        }
    }

    private func account(_ id: String) -> String {
        shell.workspace.load.ledger?.account(id: id)?.name ?? "Your account"
    }

    @ViewBuilder
    private func shares(_ expense: WireSharedExpense) -> some View {
        let people = model.people
        Section {
            ForEach(expense.splits, id: \.userId) { split in
                let status = expense.status(of: split.userId)
                HStack(spacing: 12) {
                    Monogram(initials: people.initials(split.userId))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(people.name(split.userId)).font(.body.weight(.semibold))
                        Text(status.label).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("sharedExpense.share.\(split.userId)")
                    Spacer(minLength: 8)
                    MoneyText(split.amountCents, meaning: .neutral, currency: model.currency)
                    if expense.canRecordShare(from: split.userId, people: people, archived: model.isArchived) {
                        Button("Mark as paid") { payment = .share(expense, from: split.userId) }
                            .buttonStyle(.bordered)
                            .font(.footnote.weight(.semibold))
                            .accessibilityIdentifier("sharedExpense.markPaid.\(split.userId)")
                    }
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityElement(children: .contain)
            }
        } header: {
            Text("Shares")
        } footer: {
            if expense.paymentsClosed {
                Text("This month has a monthly payment, so the remaining balance settles with the month.")
            } else {
                Text("Mark a share as paid once that person has paid outside Penny. Penny doesn't move money.")
            }
        }
    }

    @ViewBuilder
    private func actions(_ expense: WireSharedExpense) -> some View {
        if !model.isReadOnly {
            Section {
                Button("Edit", systemImage: "pencil") { form = .expense(expense) }
                    .accessibilityIdentifier("sharedExpense.edit")
                Button("Delete for everyone", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                    .disabled(expense.isPaid)
                    .accessibilityIdentifier("sharedExpense.delete")
            } footer: {
                if expense.isPaid {
                    Text(
                        "Someone has repaid a share, so this expense can't be deleted, and its total, payer, month "
                            + "and shares can't change. Its name, category and note still can.")
                }
            }
        }
    }

    @ViewBuilder private var history: some View {
        Section("Changes") {
            if events.isEmpty {
                Text("No changes recorded.").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(events) { event in
                AuditRow(event: event, people: model.people, currency: model.currency)
            }
        }
        .accessibilityIdentifier("sharedExpense.history")
    }
}
