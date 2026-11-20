import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

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

/// Also a shared trip's page (MAZ-76, `TripDetailView`): a shared trip is a household with a
/// travel range, so it adds the trip's dates and totals, lists Expenses for the whole trip with
/// your private expenses under Only you, and says "trip" (`SharedTripSections.swift`).
struct HouseholdPage: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    /// Opened as a trip (`penny://trips/<id>`): says "trip" before the household has loaded.
    var opensAsTrip = false
    @State private var section: HouseholdSection = .expenses
    @State private var editingTrip = false
    @State private var form: SharedFormRequest?
    @State private var payment: PaymentRequest?
    @State private var inviting = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirm: Confirmation?
    @State private var working = false
    @State private var width: Double = 0
    @Environment(\.horizontalSizeClass) private var sizeClass

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

    /// The trip's part of the page, for a shared trip (nil for a household).
    private var trip: SharedTripContext? { SharedTripContext(model: model, shell: shell) }
    private var isTrip: Bool { model.household.map { $0.trip != nil } ?? opensAsTrip }
    private var noun: String { isTrip ? "trip" : "household" }

    var body: some View {
        let trip = self.trip
        columns(trip: trip)
            .onGeometryChange(for: Double.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .overlay {
                if model.household == nil {
                    switch model.load {
                    case .failed(let failure):
                        PennyStateView(
                            failure.kind == .offline ? .offline : .error,
                            title: failure.kind == .membership
                                ? (isTrip ? "Trip not available" : "Household not available")
                                : "Couldn't open the \(noun)",
                            message: failure.kind == .membership
                                ? "You may have left it, been removed, or it doesn't exist on this server."
                                : failure.message, actionTitle: failure.canRetry ? "Try again" : nil,
                            action: { Task { await model.refresh() } })
                    default:
                        PennyStateView(.loading, title: "Opening the \(noun)…")
                    }
                }
            }
            .refreshable {
                await model.refresh()
                await refreshTrip()
            }
            .task {
                // Trip expense from the Trips list opens the form once the page is here. Taken
                // before the reads, so a failed or offline load (or leaving early) never leaves it
                // to open the form later, unasked.
                let wantsAdd = shell.trips.takePendingAdd(for: model.id)
                model.followCurrentMonth(MonthKey(shell.today))
                await model.refresh()
                await refreshTrip()
                if wantsAdd, !Task.isCancelled, model.household?.trip != nil, !model.isReadOnly {
                    addExpense()
                }
            }
            .onChange(of: model.writeCount) {
                Task {
                    await shell.refreshShared()
                    await refreshTrip()
                }
            }
            .navigationTitle(model.household?.name ?? (isTrip ? "Trip" : "Household"))
            .sheet(isPresented: $editingTrip) {
                if let household = model.household {
                    TripFormSheet(target: .shared(household), expenseCount: 0) { _ in }.environment(shell)
                }
            }
            .toolbar {
                if canInvite {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Invite someone", systemImage: "person.badge.plus") { inviting = true }
                            .accessibilityIdentifier("household.invite")
                    }
                }
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

    // MARK: Columns

    /// iPad (`ipad-shared`, `ipad-trip`; MAZ-182): the expenses with the balances beside them
    /// when the column is wide enough, so there is no section to switch. Otherwise one list
    /// with Expenses, Balances and People as sections.
    private var isTwoColumn: Bool { sizeClass == .regular && Self.isTwoColumn(width: width) }

    /// Two columns need a page this wide.
    static func isTwoColumn(width: Double) -> Bool { width >= 700 }

    /// The balances column's width: the card's 420 points, or less on a narrower page.
    static func sideWidth(for width: Double) -> Double { min(420, (width * 0.46).rounded()) }

    @ViewBuilder
    private func columns(trip: SharedTripContext?) -> some View {
        if isTwoColumn, let household = model.household {
            HStack(spacing: 0) {
                List {
                    header(household, trip: trip)
                    mainColumn(trip: trip)
                }
                .insetGroupedList()
                Divider().ignoresSafeArea()
                List {
                    sideColumn(household, trip: trip)
                }
                .insetGroupedList()
                .frame(width: Self.sideWidth(for: width))
            }
        } else {
            List {
                if let household = model.household {
                    header(household, trip: trip)
                    content(household, trip: trip)
                }
            }
            .insetGroupedList()
        }
    }

    @ViewBuilder
    private func mainColumn(trip: SharedTripContext?) -> some View {
        if let trip {
            SharedTripExpenseSections(context: trip, model: model, showsShareByCategory: false)
        } else {
            expensesSection
        }
        rulesSection
    }

    @ViewBuilder
    private func sideColumn(_ household: WireHousehold, trip: SharedTripContext?) -> some View {
        if let trip {
            balancesSection
            SharedTripShareByCategory(context: trip, model: model)
        } else {
            Section {
                balanceHero(alignment: .leading)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            }
            balancesSection
        }
        peopleSection(household)
    }

    // MARK: Header

    /// A new expense opens Add entry with this household chosen, so it is added in the same form
    /// as any other entry. A page model the shell doesn't share (previews) uses its own sheet.
    private func addExpense() {
        if shell.households.model(for: model.id) === model {
            shell.openSharedExpense(model.id)
        } else {
            form = .new
        }
    }

    private func refreshTrip() async {
        guard model.household?.trip != nil else { return }
        await shell.trips.expenses(for: model.id)?.refresh()
    }

    @ViewBuilder
    private func header(_ household: WireHousehold, trip: SharedTripContext?) -> some View {
        Section {
            VStack(spacing: 16) {
                if let trip {
                    SharedTripHero(context: trip, model: model)
                } else {
                    householdHero(household, showsBalance: !isTwoColumn)
                }
                if !model.isReadOnly {
                    HStack(spacing: 12) {
                        // A trip's balances settle by month under Balances, so its page leads with
                        // the trip, as on the card, and only adds an expense from here.
                        if trip == nil, !isTwoColumn {
                            PennyButton("Record payment", systemImage: "checkmark.circle", role: .secondary) {
                                section = .balances
                            }
                            .accessibilityHint("Shows balances and suggested payments to record")
                            .accessibilityIdentifier("household.recordPayment")
                        }
                        PennyButton(isTrip ? "Trip expense" : "Expense", systemImage: "plus") { addExpense() }
                            .accessibilityIdentifier("household.addExpense")
                    }
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            .listRowSeparator(.hidden)
            if let reason = model.readOnlyReason {
                StatusBanner(tone: .info, title: model.isArchived ? "Archived" : "Read only", message: reason)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("household.readOnly")
            }
            if let notice = model.notice ?? model.load.failure {
                HouseholdFailureBanner(failure: notice) { Task { await model.refresh() } }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            // Two columns show the balances and people beside the expenses: nothing to switch.
            if !isTwoColumn {
                Picker("Section", selection: $section) {
                    ForEach(HouseholdSection.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                .accessibilityIdentifier("household.section")
            }
        }
        .listSectionSeparator(.hidden)
    }

    /// Members, the household's name, then the viewer's balance for the month in its meaning
    /// color (`iphone-shared`): owed to you is income green, owing is an expense in the label
    /// color (never red), settled is muted. The month is chosen in the section headers below.
    private func householdHero(_ household: WireHousehold, showsBalance: Bool) -> some View {
        VStack(spacing: 6) {
            MonogramStack(initials: model.people.current.map { model.people.initials($0.userId) })
                .padding(.bottom, 4)
            Text(household.name).font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if showsBalance {
                balanceHero(alignment: .center).padding(.top, 8)
            } else {
                // `ipad-shared`: the month's total under the name; the balance is beside it.
                let total = model.expenses.reduce(Int64(0)) { $0 + $1.totalCents }
                Text(
                    "\(HouseholdText.shortMonth(model.month)) · "
                        + "\(MoneyFormat.amount(total, currency: model.currency)) in shared expenses"
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("household.monthTotal")
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The viewer's balance for the month in its meaning color: under the name, or at the top
    /// of the balances column on a wide iPad.
    private func balanceHero(alignment: HorizontalAlignment) -> some View {
        let balance = model.viewerBalance
        return VStack(alignment: alignment, spacing: 2) {
            Text("\(HouseholdText.shortMonth(model.month)) · \(Self.balanceLabel(balance))")
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            Text(MoneyFormat.amount(abs(balance), currency: model.currency))
                .modifier(HeroAmountFont())
                .foregroundStyle(
                    balance > 0 ? PennyColor.income : balance < 0 ? PennyColor.label : PennyColor.secondaryLabel
                )
                .lineLimit(1)
                .minimumScaleFactor(0.4)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(HouseholdText.month(model.month)), \(HouseholdText.balance(balance, currency: model.currency))"
        )
        .accessibilityIdentifier("household.balance")
    }

    /// The month a section shows, with the previous and next month: the header of Expenses and
    /// Balances, as the card's "November … total" header.
    private func monthHeader(trailing: String) -> some View {
        HStack(spacing: 4) {
            Button("Previous month", systemImage: "chevron.left") {
                if let previous = model.month.shifted(by: -1) {
                    Task { await model.show(month: previous, current: MonthKey(shell.today)) }
                }
            }
            .labelStyle(.iconOnly)
            .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
            .accessibilityIdentifier("household.previousMonth")
            Text(HouseholdText.shortMonth(model.month))
                .accessibilityLabel(HouseholdText.month(model.month))
                .accessibilityIdentifier("household.month")
            Button("Next month", systemImage: "chevron.right") {
                if let next = model.month.shifted(by: 1) {
                    Task { await model.show(month: next, current: MonthKey(shell.today)) }
                }
            }
            .labelStyle(.iconOnly)
            .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
            .disabled(model.month >= MonthKey(shell.today))
            .accessibilityIdentifier("household.nextMonth")
            Spacer()
            Text(trailing)
        }
        .buttonStyle(.borderless)
        .padding(.leading, -14)
    }

    static func balanceLabel(_ cents: Int64) -> String {
        cents > 0 ? "you're owed" : cents < 0 ? "you owe" : "settled"
    }

    @ViewBuilder
    private func content(_ household: WireHousehold, trip: SharedTripContext?) -> some View {
        switch section {
        case .expenses:
            if let trip {
                SharedTripExpenseSections(context: trip, model: model)
                rulesSection
            } else {
                expensesSection
                rulesSection
            }
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
            monthHeader(trailing: "\(MoneyFormat.amount(total, currency: model.currency)) total")
        }
    }

    @ViewBuilder private var rulesSection: some View {
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
            monthHeader(trailing: HouseholdText.settles(model.month))
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

    /// Only the creator invites, and not once the household is read only.
    private var canInvite: Bool { model.household != nil && model.isCreator && !model.isReadOnly }

    private func joiningNote(_ household: WireHousehold) -> String {
        isTrip
            ? "Everyone uses \(household.currency). People who join are in the trip's expenses added from then on; "
                + "earlier expenses keep the people they were split with."
            : "Everyone uses \(household.currency). New members are included in equal splits from the day they "
                + "join; earlier expenses don't change."
    }

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
            if !canInvite { Text(joiningNote(household)) }
        }
        if canInvite {
            Section {
                InlineInvite(model: model) { inviting = true }
            } header: {
                Text("Invite someone")
            } footer: {
                Text(joiningNote(household))
            }
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
                    if isTrip {
                        Button("Edit trip", systemImage: "pencil") { editingTrip = true }
                            .accessibilityIdentifier("tripPage.edit")
                    } else {
                        Button("Rename", systemImage: "pencil") {
                            newName = household.name
                            renaming = true
                        }
                        .accessibilityIdentifier("household.rename")
                    }
                }
                Button(
                    isTrip ? "Leave trip" : "Leave household", systemImage: "rectangle.portrait.and.arrow.right",
                    role: .destructive
                ) {
                    confirm = .leave
                }
                .accessibilityIdentifier("household.leave")
                if model.isCreator {
                    Button(isTrip ? "Archive trip" : "Archive household", systemImage: "archivebox", role: .destructive)
                    {
                        confirm = .archive
                    }
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
                shell.navigate { $0.open(isTrip ? .trips : .households) }
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

/// The invite under People (`iphone-shared-people`): the code with its countdown, Copy and Share,
/// once the creator asks for one. A new code replaces the one already shared, so opening People
/// never makes one by itself; an unexpired code from this session shows again. The QR code is in
/// the invite sheet (Show QR code, or Invite someone in the toolbar).
private struct InlineInvite: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    let showQR: () -> Void
    @State private var working = false
    @State private var width: Double = 0
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var failure: HouseholdFailure?

    var body: some View {
        VStack(spacing: 12) {
            if let failure {
                HouseholdFailureBanner(failure: failure) { Task { await create() } }
            }
            if let invite = model.invite, let code = InviteCode(typed: invite.code) {
                InviteCard(
                    expiresAt: model.inviteExpiresAt ?? Date(milliseconds: invite.expiresAt), code: code,
                    link: InviteLink(code: code, server: shell.account?.server),
                    renew: { Task { await create() } },
                    copy: {
                        #if os(iOS)
                            UIPasteboard.general.string = code.value
                        #endif
                    },
                    showsQR: false)
                Button("Show QR code", systemImage: "qrcode", action: showQR)
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityIdentifier("household.inviteQR")
            } else {
                Text("Make a code to share. It works for 10 minutes, for everyone you send it to.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                PennyButton(working ? "Creating a code…" : "Create invite code", systemImage: "person.badge.plus") {
                    Task { await create() }
                }
                .disabled(working)
                .accessibilityIdentifier("household.inviteCreate")
            }
        }
        .frame(maxWidth: .infinity)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    private func create() async {
        working = true
        defer { working = false }
        failure = await model.newInvite()
    }
}
