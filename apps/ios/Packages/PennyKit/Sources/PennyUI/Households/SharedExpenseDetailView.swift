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
    @State private var deleting: SharedDeleteRequest?

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
        // The page leads with the title, so the bar has only Back and the … menu.
        .contentMargins(.top, 0, for: .scrollContent)
        .background(alignment: .top) {
            Color.clear.frame(height: 1).heroGlow(tint: viewerIsOwed ? PennyColor.income : nil)
        }
        .toolbar {
            ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
            if let expense, !model.isReadOnly {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Edit", systemImage: "square.and.pencil") { form = .expense(expense) }
                        // Its schedule, which the household page doesn't list (MAZ-256).
                        if let rule = model.rules.first(where: { $0.id == expense.recurringId }) {
                            Button("Repeating expense", systemImage: "repeat") { form = .rule(rule) }
                                .accessibilityIdentifier("sharedExpense.rule")
                        }
                        Button("Delete for everyone", systemImage: "trash", role: .destructive) {
                            requestDelete(expense)
                        }
                        .disabled(expense.isPaid)
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                    .neutralToolbarGlyph()
                    .accessibilityIdentifier("sharedExpense.more")
                }
            }
        }
        .sheet(item: $form) { request in
            SharedExpenseFormSheet(request: request, model: model).environment(shell)
        }
        .sheet(item: $payment, onDismiss: { Task { await load() } }) { request in
            PaymentSheet(request: request, model: model, now: shell.now)
        }
        // The `delete-confirm` card: the expense, its members and Delete for everyone.
        .sharedDeleteConfirmation($deleting) { dismiss() }
    }

    /// The `delete-confirm` card: the expense, its members and Delete for everyone.
    private func requestDelete(_ expense: WireSharedExpense) {
        deleting = SharedDeleteRequest(
            householdId: model.id, expenseId: expense.id, title: expense.title, total: expense.totalCents,
            date: CalendarDate.ledgerDate(expense.date) ?? shell.today,
            householdName: model.household?.name ?? "", symbol: expense.category.symbol,
            color: expense.category.tint)
    }

    /// The viewer paid and others owe them: the glow is green, as on the card.
    private var viewerIsOwed: Bool {
        guard let expense, let me = model.people.meId, expense.payerUserId == me else { return false }
        return expense.totalCents > expense.share(of: me)
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

    // MARK: Sections

    /// `iphone-shared-expense-detail`: the category tile and title, the Total over "Nov 4 · You
    /// paid · split equally", then the details.
    @ViewBuilder
    private func summary(_ expense: WireSharedExpense) -> some View {
        let people = model.people
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    CategoryIcon(symbol: expense.category.symbol, color: expense.category.tint, size: 40)
                    Text(expense.title).font(.title2.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Total").font(.caption).foregroundStyle(PennyColor.secondaryLabel)
                    Text(MoneyFormat.amount(expense.totalCents, currency: model.currency))
                        .font(.largeTitle.weight(.bold)).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.5)
                    Text(
                        "\(HouseholdText.day(expense.date)) · \(people.name(expense.payerUserId)) paid · split "
                            + expense.mode.label.lowercased()
                    )
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .padding(.top, 2)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sharedExpense.total")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8))
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
                MoneyText(expense.share(of: people.meId), meaning: .neutral, currency: model.currency)
                    .fontWeight(.medium)
            }
            .accessibilityIdentifier("sharedExpense.yourShare")
            LabeledContent("Category") {
                HStack(spacing: 8) {
                    CategoryIcon(symbol: expense.category.symbol, color: expense.category.tint, size: 24)
                    Text(expense.category.name)
                }
                .foregroundStyle(PennyColor.label)
            }
            if !expense.note.isEmpty {
                LabeledContent("Note") { Text(expense.note).foregroundStyle(PennyColor.label).lineLimit(1) }
            }
            if expense.payerUserId == people.meId, let accountId = expense.accountId {
                LabeledContent("Paid with") {
                    Label(account(accountId), systemImage: "lock").foregroundStyle(PennyColor.label)
                }
            }
            if expense.receipt != nil || expense.receiptId != nil {
                LabeledContent("Receipt") {
                    Label(
                        expense.receipt.map { $0.mime.hasPrefix("image/") ? "1 photo" : $0.name } ?? "Attached",
                        systemImage: "doc.text.image"
                    )
                    .foregroundStyle(PennyColor.label)
                }
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

    /// Each share: the monogram and name over the amount (or "Paid · payer"), then a green Paid,
    /// Mark as paid as a tinted capsule, or what's left of it.
    @ViewBuilder
    private func shares(_ expense: WireSharedExpense) -> some View {
        let people = model.people
        Section {
            ForEach(expense.splits, id: \.userId) { split in
                let status = expense.status(of: split.userId)
                let isPayer = split.userId == expense.payerUserId
                HStack(spacing: 12) {
                    Monogram(initials: people.initials(split.userId), size: 32)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(people.name(split.userId)).font(.body.weight(.semibold))
                        Text(isPayer ? "Paid · payer" : MoneyFormat.amount(split.amountCents, currency: model.currency))
                            .font(.footnote).monospacedDigit().foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("sharedExpense.share.\(split.userId)")
                    Spacer(minLength: 8)
                    if isPayer {
                        MoneyText(split.amountCents, meaning: .neutral, currency: model.currency)
                    } else if status == .paid {
                        Label("Paid", systemImage: "checkmark.circle")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.income)
                    } else if expense.canRecordShare(from: split.userId, people: people, archived: model.isArchived) {
                        Button("Mark as paid") { payment = .share(expense, from: split.userId) }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(PennyColor.tintText)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 30)
                            .background(PaletteToken.tintSoft.value.color, in: Capsule())
                            .buttonStyle(.borderless)
                            .frame(minHeight: Metrics.minTouchTarget)
                            .accessibilityIdentifier("sharedExpense.markPaid.\(split.userId)")
                    } else {
                        Text(status.label).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                .frame(minHeight: 50)
                .accessibilityElement(children: .contain)
            }
        } header: {
            Text("Shares").cardSectionHeader()
        } footer: {
            if expense.paymentsClosed {
                Text("This month has a monthly payment, so the remaining balance settles with the month.")
            } else {
                Text("Mark a share as paid once that person has paid outside Penny. Penny doesn't move money.")
            }
        }
    }

    /// Edit and Delete for everyone, side by side as on the card.
    @ViewBuilder
    private func actions(_ expense: WireSharedExpense) -> some View {
        if !model.isReadOnly {
            Section {
                HStack(spacing: 10) {
                    Button {
                        form = .expense(expense)
                    } label: {
                        Label("Edit", systemImage: "square.and.pencil").detailAction(color: PennyColor.label)
                    }
                    .buttonStyle(.plain)
                    .frame(width: 120)
                    .accessibilityIdentifier("sharedExpense.edit")
                    Button("Delete for everyone", systemImage: "trash", role: .destructive) { requestDelete(expense) }
                        .buttonStyle(DetailActionStyle())
                        .disabled(expense.isPaid)
                        .accessibilityIdentifier("sharedExpense.delete")
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
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
        CardSection("Changes") {
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

extension View {
    /// The card's Edit and Delete for everyone: a capsule on the surface.
    fileprivate func detailAction(color: Color) -> some View {
        font(.body.weight(.semibold))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
            .background(PennyColor.surface, in: Capsule())
            .contentShape(Capsule())
    }
}

/// Delete for everyone in red on its capsule, dimmed while a repaid share keeps the expense.
private struct DetailActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .detailAction(color: PennyColor.danger)
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.45)
    }
}
