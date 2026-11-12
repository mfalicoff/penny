import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A household (`iphone-shared`, `iphone-shared-balances`, `iphone-shared-people`, `ipad-shared`):
/// members and the viewer's balance for the month, Record payment and Expense, then Expenses,
/// Balances and People. History is in the toolbar.
///
/// Everything here is read from and written to the server. Archived households and former
/// members get a read-only page that says why; every refused write says what changed and the
/// page reads again, so a membership change elsewhere shows at once.
struct HouseholdDetailView: View {
    @Environment(ShellModel.self) private var shell
    let id: String

    var body: some View {
        Group {
            if let model = shell.households.model(for: id) {
                HouseholdPage(model: model)
            } else {
                PennyStateView(
                    .unavailable, title: "Household",
                    message: "Households need your account. The demo doesn't have any."
                )
                .navigationTitle("Household")
            }
        }
        .background(PennyColor.background)
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.household")
    }
}

/// Which part of a household is showing.
enum HouseholdSection: String, CaseIterable, Hashable {
    case expenses, balances, people

    var title: String {
        switch self {
        case .expenses: "Expenses"
        case .balances: "Balances"
        case .people: "People"
        }
    }
}

/// What the shared expense form sheet edits.
enum SharedFormRequest: Identifiable, Equatable {
    case new
    case expense(WireSharedExpense)
    case rule(WireSharedRule)

    var id: String {
        switch self {
        case .new: "new"
        case .expense(let expense): "expense \(expense.id) \(expense.revision)"
        case .rule(let rule): "rule \(rule.id) \(rule.revision)"
        }
    }
}

/// A payment to record from a household page.
enum PaymentRequest: Identifiable, Equatable {
    case share(WireSharedExpense, from: String)
    case monthly(WireTransfer, month: MonthKey)

    var id: String {
        switch self {
        case .share(let expense, let from): "share \(expense.id) \(from)"
        case .monthly(let transfer, let month): "monthly \(month) \(transfer.fromUserId) \(transfer.toUserId)"
        }
    }
}

private struct HouseholdPage: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    @State private var section: HouseholdSection = .expenses
    @State private var form: SharedFormRequest?
    @State private var payment: PaymentRequest?
    @State private var inviting = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirm: Confirmation?
    @State private var working = false

    enum Confirmation: Identifiable, Equatable {
        case leave, archive
        case remove(WireHouseholdMember)
        case deleteRule(WireSharedRule)

        var id: String {
            switch self {
            case .leave: "leave"
            case .archive: "archive"
            case .remove(let member): "remove \(member.userId)"
            case .deleteRule(let rule): "rule \(rule.id)"
            }
        }
    }

    var body: some View {
        List {
            if let household = model.household {
                header(household)
                content(household)
            }
        }
        .insetGroupedList()
        .overlay {
            if model.household == nil {
                switch model.load {
                case .failed(let failure):
                    PennyStateView(
                        failure.kind == .offline ? .offline : .error,
                        title: failure.kind == .membership ? "Household not available" : "Couldn't open the household",
                        message: failure.kind == .membership
                            ? "You may have left it, been removed, or it doesn't exist on this server."
                            : failure.message, actionTitle: failure.canRetry ? "Try again" : nil,
                        action: { Task { await model.refresh() } })
                default:
                    PennyStateView(.loading, title: "Opening the household…")
                }
            }
        }
        .refreshable { await model.refresh() }
        .task {
            model.followCurrentMonth(MonthKey(shell.today))
            await model.refresh()
        }
        .onChange(of: model.writeCount) { Task { await shell.refreshShared() } }
        .navigationTitle(model.household?.name ?? "Household")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: DetailRoute.householdHistory(householdID: model.id)) {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                .accessibilityIdentifier("household.history")
            }
        }
        .sheet(item: $form) { request in
            SharedExpenseFormSheet(request: request, model: model).environment(shell)
        }
        .sheet(item: $payment) { request in
            PaymentSheet(request: request, model: model)
        }
        .sheet(isPresented: $inviting, onDismiss: { Task { await model.refresh() } }) {
            InviteSheet(model: model).environment(shell)
        }
        .alert("Rename household", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Rename") { Task { _ = await model.rename(newName) } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
            titleVisibility: .visible, presenting: confirm
        ) { confirmation in
            Button(confirmButton(confirmation), role: .destructive) { Task { await run(confirmation) } }
            Button("Cancel", role: .cancel) {}
        } message: { confirmation in
            Text(confirmMessage(confirmation))
        }
    }

    // MARK: Header

    @ViewBuilder
    private func header(_ household: WireHousehold) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                MonogramStack(initials: model.people.current.map { model.people.initials($0.userId) })
                HeroAmount(
                    "\(HouseholdText.shortMonth(model.month)) · \(Self.balanceLabel(model.viewerBalance))",
                    cents: abs(model.viewerBalance), currency: model.currency,
                    tone: model.viewerBalance > 0 ? .income : .neutral
                )
                .accessibilityIdentifier("household.balance")
                monthPicker
                if !model.isReadOnly {
                    HStack(spacing: 12) {
                        PennyButton("Record payment", systemImage: "checkmark.circle", role: .secondary) {
                            section = .balances
                        }
                        .accessibilityHint("Shows balances and suggested payments to record")
                        .accessibilityIdentifier("household.recordPayment")
                        PennyButton("Expense", systemImage: "plus") { form = .new }
                            .accessibilityIdentifier("household.addExpense")
                    }
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            if let reason = model.readOnlyReason {
                StatusBanner(tone: .info, title: model.isArchived ? "Archived" : "Read only", message: reason)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("household.readOnly")
            }
            if let notice = model.notice ?? model.load.failure {
                HouseholdFailureBanner(failure: notice) { Task { await model.refresh() } }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            Picker("Section", selection: $section) {
                ForEach(HouseholdSection.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            .accessibilityIdentifier("household.section")
        }
        .listSectionSeparator(.hidden)
    }

    private var monthPicker: some View {
        HStack {
            Button("Previous month", systemImage: "chevron.left") {
                if let previous = model.month.shifted(by: -1) {
                    Task { await model.show(month: previous, current: MonthKey(shell.today)) }
                }
            }
            .labelStyle(.iconOnly)
            .accessibilityIdentifier("household.previousMonth")
            Spacer()
            Text(HouseholdText.month(model.month)).font(.subheadline.weight(.semibold))
                .accessibilityIdentifier("household.month")
            Spacer()
            Button("Next month", systemImage: "chevron.right") {
                if let next = model.month.shifted(by: 1) {
                    Task { await model.show(month: next, current: MonthKey(shell.today)) }
                }
            }
            .labelStyle(.iconOnly)
            .disabled(model.month >= MonthKey(shell.today))
            .accessibilityIdentifier("household.nextMonth")
        }
        .buttonStyle(.borderless)
        .frame(minHeight: Metrics.minTouchTarget)
    }

    static func balanceLabel(_ cents: Int64) -> String {
        cents > 0 ? "you're owed" : cents < 0 ? "you owe" : "settled"
    }

    @ViewBuilder
    private func content(_ household: WireHousehold) -> some View {
        switch section {
        case .expenses: expensesSection
        case .balances: balancesSection
        case .people: peopleSection(household)
        }
    }

    // MARK: Expenses

    @ViewBuilder private var expensesSection: some View {
        let total = model.expenses.reduce(Int64(0)) { $0 + $1.totalCents }
        Section {
            if model.expenses.isEmpty {
                Text(
                    model.isReadOnly
                        ? "No expenses you shared this month."
                        : "No shared expenses this month. Add one with Expense; everyone sees it and their share."
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(model.expenses) { expense in
                NavigationLink(
                    value: DetailRoute.householdExpense(householdID: model.id, expenseID: expense.id)
                ) {
                    SharedExpenseRow(expense: expense, people: model.people, currency: model.currency)
                }
                .accessibilityIdentifier("household.expense.\(expense.id)")
            }
        } header: {
            HStack {
                Text(HouseholdText.shortMonth(model.month))
                Spacer()
                Text("\(MoneyFormat.amount(total, currency: model.currency)) total")
            }
        }
        if !model.rules.isEmpty {
            Section {
                ForEach(model.rules) { rule in
                    Button {
                        if !model.isReadOnly { form = .rule(rule) }
                    } label: {
                        SharedRuleRow(rule: rule, people: model.people, currency: model.currency)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        if !model.isReadOnly {
                            Button(rule.active ? "Pause" : "Resume", systemImage: rule.active ? "pause" : "play") {
                                Task { _ = await model.setActive(rule, !rule.active) }
                            }
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                confirm = .deleteRule(rule)
                            }
                        }
                    }
                    .accessibilityIdentifier("household.rule.\(rule.id)")
                }
            } header: {
                Text("Repeating")
            } footer: {
                Text(
                    "Repeating expenses are added on their date with the members active that day. Pausing skips "
                        + "the dates while paused.")
            }
        }
    }

    // MARK: Balances

    @ViewBuilder private var balancesSection: some View {
        let recap = model.recap
        Section {
            ForEach(recap?.balances ?? [], id: \.userId) { balance in
                BalanceRow(
                    balance: balance, people: model.people, expenses: model.expenses, currency: model.currency
                )
                .accessibilityIdentifier("household.balanceRow.\(balance.userId)")
            }
            if recap?.balances.isEmpty ?? true {
                Text("Nobody shared anything this month.").font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
        } header: {
            HStack {
                Text(HouseholdText.shortMonth(model.month))
                Spacer()
                Text(HouseholdText.settles(model.month))
            }
        }
        if let recap, !recap.suggestions.isEmpty {
            Section {
                ForEach(recap.suggestions, id: \.self) { transfer in
                    SuggestionRow(
                        transfer: transfer, people: model.people, currency: model.currency,
                        canRecord: canRecord(transfer)
                    ) {
                        payment = .monthly(transfer, month: model.month)
                    }
                    .accessibilityIdentifier("household.suggestion.\(transfer.fromUserId)-\(transfer.toUserId)")
                }
            } header: {
                Text("Suggested payments")
            } footer: {
                Text(
                    isOpen
                        ? "Record a payment once it has happened outside Penny. Penny doesn't move money."
                        : "Monthly payments open on the last day of the month. To repay a single expense now, use "
                            + "Mark as paid on its share."
                )
                .accessibilityIdentifier("household.monthlyNote")
            }
        } else if recap != nil {
            Section {
                Text("Everyone is settled for \(HouseholdText.shortMonth(model.month)).")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityIdentifier("household.monthlyNote")
            }
        }
        let overdue = (recap?.overdueMonths ?? []).filter { $0 != "\(model.month)" }
        if !overdue.isEmpty {
            Section("Overdue") {
                ForEach(overdue, id: \.self) { month in
                    Button {
                        if let key = MonthKey(month) {
                            Task { await model.show(month: key, current: MonthKey(shell.today)) }
                        }
                    } label: {
                        HStack {
                            Text(MonthKey(month).map(HouseholdText.month) ?? month)
                            Spacer()
                            Text("Overdue").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.pending)
                        }
                    }
                    .accessibilityHint("Shows that month's balances")
                    .accessibilityIdentifier("household.overdue.\(month)")
                }
            }
        }
    }

    private var isOpen: Bool {
        SettlementCalendar.monthlyPaymentsOpen(model.month, todayUTC: CalendarDate(Date(), in: Self.utc))
    }

    static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    private func canRecord(_ transfer: WireTransfer) -> Bool {
        guard !model.isReadOnly, let me = model.people.meId else { return false }
        return transfer.fromUserId == me || transfer.toUserId == me
    }

    // MARK: People

    @ViewBuilder
    private func peopleSection(_ household: WireHousehold) -> some View {
        let people = model.people
        Section {
            ForEach(people.current) { member in
                MemberRow(member: member, people: people, isCreator: member.userId == household.creatorId)
                    .swipeActions {
                        if model.isCreator, member.userId != household.creatorId, !model.isReadOnly {
                            Button("Remove", role: .destructive) { confirm = .remove(member) }
                                .accessibilityIdentifier("household.removeMember.\(member.userId)")
                        }
                    }
                    .contextMenu {
                        if model.isCreator, member.userId != household.creatorId, !model.isReadOnly {
                            Button("Remove from household", systemImage: "person.badge.minus", role: .destructive) {
                                confirm = .remove(member)
                            }
                        }
                    }
                    .accessibilityIdentifier("household.member.\(member.userId)")
            }
        } header: {
            Text(people.current.count == 1 ? "1 member" : "\(people.current.count) members")
        } footer: {
            Text(
                "Everyone uses \(household.currency). New members are included in equal splits from the day they "
                    + "join; earlier expenses don't change.")
        }
        if !people.former.isEmpty {
            Section("Former members") {
                ForEach(people.former) { member in
                    MemberRow(member: member, people: people, isCreator: false)
                        .accessibilityIdentifier("household.member.\(member.userId)")
                }
            }
        }
        if !model.isReadOnly {
            Section {
                if model.isCreator {
                    Button("Invite someone", systemImage: "person.badge.plus") { inviting = true }
                        .accessibilityIdentifier("household.invite")
                    Button("Rename", systemImage: "pencil") {
                        newName = household.name
                        renaming = true
                    }
                    .accessibilityIdentifier("household.rename")
                }
                Button("Leave household", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    confirm = .leave
                }
                .accessibilityIdentifier("household.leave")
                if model.isCreator {
                    Button("Archive household", systemImage: "archivebox", role: .destructive) { confirm = .archive }
                        .accessibilityIdentifier("household.archive")
                }
            } footer: {
                Text(
                    "You can leave, or be removed, once your balance is zero in every month. Archiving needs "
                        + "everyone settled in every month; it's final, and the history stays readable.")
            }
        }
    }

    // MARK: Confirmations

    private var confirmTitle: String {
        switch confirm {
        case .leave: "Leave \(model.household?.name ?? "this household")?"
        case .archive: "Archive \(model.household?.name ?? "this household")?"
        case .remove(let member): "Remove \(member.email)?"
        case .deleteRule(let rule): "Stop repeating \(rule.title)?"
        case nil: ""
        }
    }

    private func confirmButton(_ confirmation: Confirmation) -> String {
        switch confirmation {
        case .leave: "Leave"
        case .archive: "Archive for everyone"
        case .remove: "Remove"
        case .deleteRule: "Stop repeating"
        }
    }

    private func confirmMessage(_ confirmation: Confirmation) -> String {
        switch confirmation {
        case .leave:
            "You'll stop seeing new expenses. Expenses you shared stay in your history. You need a zero balance in "
                + "every month first."
        case .archive:
            "Nobody can add or change anything afterwards, and invites stop working. Everyone must be settled in "
                + "every month. History stays readable."
        case .remove(let member):
            "\(member.email) stops seeing new expenses and keeps their history. They need a zero balance in every "
                + "month first."
        case .deleteRule:
            "No more expenses are added from it. Expenses it already added stay."
        }
    }

    private func run(_ confirmation: Confirmation) async {
        switch confirmation {
        case .leave:
            if await model.leave() == nil {
                shell.navigate { $0.open(.households) }
                await shell.refreshShared()
            }
        case .archive:
            if await model.archive() == nil { await shell.refreshShared() }
        case .remove(let member):
            _ = await model.remove(member.userId)
        case .deleteRule(let rule):
            _ = await model.deleteRule(rule)
        }
    }
}

// MARK: Rows

struct SharedExpenseRow: View {
    let expense: WireSharedExpense
    let people: HouseholdPeople
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            Monogram(initials: people.initials(expense.payerUserId))
            VStack(alignment: .leading, spacing: 2) {
                Text(expense.title).font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(expense.totalCents, meaning: .neutral, currency: currency)
                Text(viewerLine).font(.footnote).foregroundStyle(viewerColor)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let payer = expense.payerUserId == people.meId ? "You paid" : "\(people.name(expense.payerUserId)) paid"
        var parts = [HouseholdText.day(expense.date), payer, "split \(expense.mode.label.lowercased())"]
        if expense.recurringId != nil { parts.append("repeating") }
        if let me = people.meId, expense.status(of: me) == .paid { parts.append("Repaid") }
        return parts.joined(separator: " · ")
    }

    private var viewerLine: String {
        guard let me = people.meId else { return "" }
        let share = expense.share(of: me)
        if me == expense.payerUserId {
            let owed = expense.totalCents - share
            return owed > 0 ? "+\(MoneyFormat.amount(owed, currency: currency)) owed" : "your expense"
        }
        switch expense.status(of: me) {
        case .unpaid: return "\(MoneyFormat.minus)\(MoneyFormat.amount(share, currency: currency)) you owe"
        case .none: return "no share"
        default: return "\(MoneyFormat.amount(share, currency: currency)) your share"
        }
    }

    private var viewerColor: Color {
        guard let me = people.meId else { return PennyColor.secondaryLabel }
        return me == expense.payerUserId && expense.totalCents > expense.share(of: me)
            ? PennyColor.income : PennyColor.secondaryLabel
    }
}

private struct SharedRuleRow: View {
    let rule: WireSharedRule
    let people: HouseholdPeople
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: "repeat", color: rule.category.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.title).font(.body.weight(.semibold))
                Text(subtitle).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            MoneyText(rule.totalCents, meaning: .neutral, currency: currency)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let cadence = RecurrenceFrequency(rawValue: rule.frequency).map(SharedFormText.frequency) ?? rule.frequency
        let payer = rule.payerUserId == people.meId ? "you pay" : "\(people.name(rule.payerUserId)) pays"
        let next = rule.active ? "next \(HouseholdText.day(rule.nextDate))" : "Paused"
        return [cadence, payer, next].joined(separator: " · ")
    }
}

private struct BalanceRow: View {
    let balance: WireBalance
    let people: HouseholdPeople
    let expenses: [WireSharedExpense]
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            Monogram(initials: people.initials(balance.userId))
            VStack(alignment: .leading, spacing: 2) {
                Text(people.name(balance.userId)).font(.body.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            Text(HouseholdText.memberBalance(balance.balanceCents, currency: currency))
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(balance.balanceCents > 0 ? PennyColor.income : PennyColor.label)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        let paid = expenses.filter { $0.payerUserId == balance.userId }.reduce(Int64(0)) { $0 + $1.totalCents }
        let share = expenses.reduce(Int64(0)) { $0 + $1.share(of: balance.userId) }
        return
            "Paid \(MoneyFormat.amount(paid, currency: currency)) · share \(MoneyFormat.amount(share, currency: currency))"
    }
}

private struct SuggestionRow: View {
    let transfer: WireTransfer
    let people: HouseholdPeople
    let currency: String
    let canRecord: Bool
    let record: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("\(people.name(transfer.fromUserId)) → \(people.name(transfer.toUserId))")
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            MoneyText(transfer.amountCents, meaning: .neutral, currency: currency)
            if canRecord {
                Button("Record paid", action: record)
                    .buttonStyle(.bordered)
                    .font(.footnote.weight(.semibold))
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Record paid") { if canRecord { record() } }
    }
}

private struct MemberRow: View {
    let member: WireHouseholdMember
    let people: HouseholdPeople
    let isCreator: Bool

    var body: some View {
        HStack(spacing: 12) {
            Monogram(initials: people.initials(member.userId))
            VStack(alignment: .leading, spacing: 2) {
                Text(member.userId == people.meId ? "\(member.email) (you)" : member.email)
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            Text(isCreator ? "Creator" : member.isCurrent ? "Member" : "Former")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        let joined =
            member.joinedOn.map(HouseholdText.day)
            ?? HouseholdText.instant(member.joinedAt).formatted(.dateTime.month(.abbreviated).day())
        if let left = member.leftAt {
            return "Left \(HouseholdText.instant(left).formatted(.dateTime.month(.abbreviated).day()))"
        }
        return isCreator ? "Created \(joined)" : "Joined \(joined)"
    }
}
