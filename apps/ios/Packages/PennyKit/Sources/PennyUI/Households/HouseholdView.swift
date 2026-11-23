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
    /// The expense beside the list on a wide iPad (`ipad-shared`); the first one until another is tapped.
    @State private var selectedExpenseID: String?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var selectedExpense: WireSharedExpense? {
        model.expenses.first { $0.id == selectedExpenseID } ?? model.expenses.first
    }

    enum Confirmation: Identifiable, Equatable {
        case leave, archive
        case remove(WireHouseholdMember)

        var id: String {
            switch self {
            case .leave: "leave"
            case .archive: "archive"
            case .remove(let member): "remove \(member.userId)"
            }
        }
    }

    /// The trip's part of the page, for a shared trip (nil for a household).
    private var trip: SharedTripContext? { SharedTripContext(model: model, shell: shell) }
    private var isTrip: Bool { model.household.map { $0.trip != nil } ?? opensAsTrip }
    private var noun: String { isTrip ? "trip" : "household" }

    // MARK: Toolbar

    /// The month pill: on a household's Expenses and Balances (and beside both panes on iPad),
    /// and on a shared trip's Balances on iPhone, since a trip lists its expenses whatever the
    /// month. The iPad trip, whose card has no pill, chooses the month in its … menu.
    private var showsMonthPill: Bool {
        guard model.household != nil else { return false }
        if isTwoColumn { return trip == nil }
        return trip == nil ? section != .people : section == .balances
    }

    /// History is its own clock button on Balances and People (`iphone-shared-balances`,
    /// `iphone-shared-people`) and beside the iPad household (`ipad-shared`); on Expenses and
    /// on the iPad trip it is in the … menu (`iphone-shared`, `iphone-trip-detail`, `ipad-trip`).
    private var showsHistoryButton: Bool {
        guard model.household != nil else { return false }
        return isTwoColumn ? trip == nil : section != .expenses
    }

    /// Invite is a toolbar button where the card draws it: Expenses, and always on iPad.
    private var showsInviteButton: Bool { canInvite && (isTwoColumn || section == .expenses) }

    /// Every card but `ipad-shared` has the … menu; the iPad household keeps its actions under People.
    private var showsMoreMenu: Bool { model.household != nil && !(isTwoColumn && trip == nil) }

    /// The … menu: what the bar doesn't show, then the household's own actions.
    private var moreMenu: some View {
        Menu {
            if trip != nil, !isTwoColumn, !model.isReadOnly {
                Button("Trip expense", systemImage: "plus") { addExpense() }
                    .accessibilityIdentifier("household.addExpense")
            }
            if !showsHistoryButton {
                Button("History", systemImage: "clock") {
                    shell.navigate { $0.push(.householdHistory(householdID: model.id)) }
                }
                .accessibilityIdentifier("household.history")
            }
            if canInvite, !showsInviteButton {
                Button("Invite someone", systemImage: "person.badge.plus") { inviting = true }
                    .accessibilityIdentifier("household.invite")
            }
            if trip != nil, isTwoColumn {
                // `ipad-trip` has no month pill: People shows this month's balances.
                Picker(selection: monthBinding) {
                    ForEach(MonthPicker.months(through: MonthKey(shell.today)), id: \.self) { month in
                        Text(MonthPicker.title(month, long: true)).tag(month)
                    }
                } label: {
                    Label("Balances month", systemImage: "calendar")
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("household.month")
            }
            householdActions
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        .neutralToolbarGlyph()
        .accessibilityIdentifier("household.more")
    }

    /// Rename or Edit trip, Leave and Archive: in the … menu, or under People on the iPad household.
    @ViewBuilder private var householdActions: some View {
        if let household = model.household, !model.isReadOnly {
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
            }
        }
    }

    /// The month the page shows, chosen from a menu.
    private var monthBinding: Binding<MonthKey> {
        Binding(
            get: { model.month },
            set: { month in Task { await model.show(month: month, current: MonthKey(shell.today)) } })
    }

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
                model.followCurrentMonth(MonthKey(shell.today))
                await model.refresh()
                await refreshTrip()
            }
            .onChange(of: model.writeCount) {
                Task {
                    await shell.refreshShared()
                    await refreshTrip()
                }
            }
            .navigationTitle(model.household?.name ?? (isTrip ? "Trip" : "Household"))
            .toolbar {
                // `iphone-shared`: no title over the hero, which already leads with the name. Balances
                // and People collapse the hero, so the name is the inline title there
                // (`iphone-shared-balances`, `iphone-shared-people`). Pushed pages still go back to it.
                // A shared trip always leads with its name in the hero (`iphone-trip-detail`, `ipad-trip`).
                if showsHero || trip != nil {
                    ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
                }
            }
            .sheet(isPresented: $editingTrip) {
                if let household = model.household {
                    TripFormSheet(target: .shared(household), expenseCount: 0) { _ in }.environment(shell)
                }
            }
            .toolbar {
                // The month pill (MAZ-264): beside Back on iPhone (`iphone-shared`,
                // `iphone-shared-balances`); between previous and next over both panes on iPad
                // (`ipad-shared`).
                if showsMonthPill {
                    if isTwoColumn {
                        ToolbarItem(placement: .navigation) { HouseholdMonthStep(model: model, offset: -1) }
                        ToolbarSpacer(.fixed, placement: .navigation)
                        ToolbarItem(placement: .navigation) { HouseholdMonthPicker(model: model, showsYear: true) }
                        ToolbarSpacer(.fixed, placement: .navigation)
                        ToolbarItem(placement: .navigation) { HouseholdMonthStep(model: model, offset: 1) }
                    } else {
                        ToolbarItem(placement: .navigation) { HouseholdMonthPicker(model: model) }
                    }
                }
                if showsHistoryButton {
                    ToolbarItem(placement: .primaryAction) {
                        NavigationLink(value: DetailRoute.householdHistory(householdID: model.id)) {
                            Label("History", systemImage: "clock")
                        }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("household.history")
                    }
                }
                if showsInviteButton {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Invite someone", systemImage: "person.badge.plus") { inviting = true }
                            .neutralToolbarGlyph()
                            .accessibilityIdentifier("household.invite")
                    }
                }
                if showsMoreMenu {
                    ToolbarItem(placement: .primaryAction) { moreMenu }
                }
                // `ipad-shared`: + Expense is the copper action beside History and Invite;
                // `ipad-trip`: Trip expense after Invite and the … menu.
                if isTwoColumn, !model.isReadOnly, model.household != nil {
                    ToolbarSpacer(.fixed, placement: .primaryAction)
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            addExpense()
                        } label: {
                            // Words beside the glyph, as on the card: a toolbar Label would show the glyph only.
                            HStack(spacing: 6) {
                                Image(systemName: "plus")
                                Text(trip == nil ? "Expense" : "Trip expense")
                            }
                            .fontWeight(.semibold)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(PennyColor.tint)
                        .accessibilityIdentifier("household.addExpense")
                    }
                }
            }
            .sheet(item: $form) { request in
                SharedExpenseFormSheet(request: request, model: model).environment(shell)
            }
            .sheet(item: $payment) { request in
                PaymentSheet(request: request, model: model, now: shell.now)
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
                // `ipad-trip`: the trip's hero leads the main column over the trips' glow.
                .background(alignment: .top) { if trip != nil { tripGlow } }
                Divider().ignoresSafeArea()
                List {
                    sideColumn(household, trip: trip)
                }
                .insetGroupedList()
                // `ipad-shared`: the balance leads the side column, over its meaning-colored glow.
                .background(alignment: .top) { if trip == nil { glow } }
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
            // The hero, or the segments once it collapses, start right under the navigation bar.
            .contentMargins(.top, trip == nil ? 0 : nil, for: .scrollContent)
            .background(alignment: .top) {
                if showsHero { glow } else if trip != nil { tripGlow }
            }
        }
    }

    /// A shared trip's hero glow, as on the trip cards.
    private var tripGlow: some View {
        Color.clear.frame(height: 1).heroGlow(blobs: GlowBlob.trip)
    }

    /// The household's hero shows: Expenses on iPhone, and always beside the balances on iPad.
    /// Balances and People collapse it to the navigation bar (`iphone-shared-balances`), so their
    /// lists start under the segments. A shared trip keeps its own hero (`SharedTripHero`).
    private var showsHero: Bool {
        model.household != nil && trip == nil && (isTwoColumn || section == .expenses)
    }

    /// The hero's glow in the balance's meaning color: green when you're owed, otherwise copper.
    private var glow: some View {
        Color.clear.frame(height: 1)
            .heroGlow(tint: model.viewerBalance > 0 ? PennyColor.income : nil)
    }

    @ViewBuilder
    private func mainColumn(trip: SharedTripContext?) -> some View {
        if let trip {
            // `ipad-trip`: one Expenses card, "4 shared · 1 private", with the private rows inline.
            SharedTripExpenseSections(context: trip, model: model, combined: true)
        } else {
            wideExpenseSections
        }
    }

    @ViewBuilder
    private func sideColumn(_ household: WireHousehold, trip: SharedTripContext?) -> some View {
        if let trip {
            // `ipad-trip`: People beside the hero, each with this month's balance, then Your
            // share by category. The month's payments to record follow.
            tripPeopleSection
            SharedTripShareByCategory(context: trip, model: model)
            suggestionsSection
            overdueSections
        } else {
            Section {
                balanceHero(alignment: .leading)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            }
            wideBalancesSection
            if let expense = selectedExpense { SelectedExpenseSection(expense: expense, model: model) { payment = $0 } }
            overdueSections
            peopleSection(household)
        }
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
            if let trip {
                // A trip's balances settle by month under Balances, so its page leads with the
                // trip, as on the card. Trip expense is in the … menu on iPhone (the card relies
                // on Add entry) and the toolbar's copper capsule on iPad.
                SharedTripHero(context: trip, model: model)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
                    .listRowSeparator(.hidden)
            } else if isTwoColumn {
                // `ipad-shared`: the name large and leading with the members beside it, then the
                // month's total. The balance leads the side column; + Expense is in the toolbar.
                wideHeader(household)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
                    .listRowSeparator(.hidden)
            } else if showsHero {
                VStack(spacing: 18) {
                    householdHero(household)
                    if !model.isReadOnly {
                        // `iphone-shared`: Record payment is the copper action, + Expense beside it.
                        HStack(spacing: 12) {
                            PennyButton("Record payment", systemImage: "checkmark.circle") {
                                section = .balances
                            }
                            .accessibilityHint("Shows balances and suggested payments to record")
                            .accessibilityIdentifier("household.recordPayment")
                            PennyButton("Expense", systemImage: "plus", role: .secondary) { addExpense() }
                                .accessibilityIdentifier("household.addExpense")
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 4))
                .listRowSeparator(.hidden)
            }
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
    private func householdHero(_ household: WireHousehold) -> some View {
        VStack(spacing: 6) {
            MonogramStack(initials: model.people.current.map { model.people.initials($0.userId) }, size: 44)
                .padding(.bottom, 4)
            Text(household.name).font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            balanceHero(alignment: .center).padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
    }

    /// `ipad-shared`'s list header: the name as a large title with the members on the right, and
    /// the month's shared total under it.
    private func wideHeader(_ household: WireHousehold) -> some View {
        let total = model.expenses.reduce(Int64(0)) { $0 + $1.totalCents }
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(household.name).font(.largeTitle.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                MonogramStack(initials: model.people.current.map { model.people.initials($0.userId) }, size: 30)
            }
            Text(
                "\(HouseholdText.shortMonth(model.month)) · "
                    + "\(MoneyFormat.amount(total, currency: model.currency)) in shared expenses"
            )
            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityIdentifier("household.monthTotal")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

    /// The header of Expenses and Balances: the month the page shows, as the card's
    /// "November … total" header. The month is chosen with the pill in the navigation bar.
    private func monthHeader(trailing: String) -> some View {
        monthHeader { Text(trailing).cardSectionHeader() }
    }

    private func monthHeader<Trailing: View>(
        _ month: MonthKey? = nil, @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        let month = month ?? model.month
        return HStack(spacing: 8) {
            Text(HouseholdText.shortMonth(month))
                .cardSectionHeader()
                .accessibilityLabel(HouseholdText.month(month))
            Spacer()
            trailing()
        }
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
            } else {
                expensesSection
            }
        case .balances: balancesSection
        case .people: peopleSection(household)
        }
    }

    // MARK: Expenses

    /// The month's expenses under "November … $3,412.80 total" (`iphone-shared`). Repeating
    /// expenses show with their cadence; their schedules are edited from Recurring.
    @ViewBuilder private var expensesSection: some View {
        let total = model.expenses.reduce(Int64(0)) { $0 + $1.totalCents }
        Section {
            if model.expenses.isEmpty { emptyExpenses }
            ForEach(model.expenses) { expense in expenseRow(expense) }
        } header: {
            monthHeader(trailing: "\(MoneyFormat.amount(total, currency: model.currency)) total")
        }
    }

    /// `ipad-shared`: the list under the header groups the current month's expenses as This
    /// week and Earlier; a past month's are one list under its name.
    @ViewBuilder private var wideExpenseSections: some View {
        let groups = Self.weekGroups(model.expenses, month: model.month, today: shell.today)
        if groups.isEmpty {
            Section {
                emptyExpenses
            } header: {
                monthHeader { EmptyView() }
            }
        }
        ForEach(groups, id: \.title) { group in
            Section {
                ForEach(group.expenses) { expense in expenseRow(expense) }
            } header: {
                Text(group.title).cardSectionHeader()
            }
        }
    }

    /// The expenses as `ipad-shared` lists them: in the current month, the last seven days as
    /// This week, then Earlier; in any other month, one group under the month's name.
    static func weekGroups(
        _ expenses: [WireSharedExpense], month: MonthKey, today: CalendarDate
    ) -> [(title: String, expenses: [WireSharedExpense])] {
        guard !expenses.isEmpty else { return [] }
        guard month.contains(today) else { return [(HouseholdText.shortMonth(month), expenses)] }
        let weekStart = today.adding(days: -6)
        let thisWeek = expenses.filter { CalendarDate.ledgerDate($0.date).map { $0 >= weekStart } ?? false }
        let earlier = expenses.filter { expense in !thisWeek.contains { $0.id == expense.id } }
        return [("This week", thisWeek), ("Earlier", earlier)].filter { !$0.expenses.isEmpty }
    }

    private var emptyExpenses: some View {
        Text(
            model.isReadOnly
                ? "No expenses you shared this month."
                : "No shared expenses this month. Add one with Expense; everyone sees it and their share."
        )
        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
    }

    @ViewBuilder
    private func expenseRow(_ expense: WireSharedExpense) -> some View {
        let row = SharedExpenseRow(
            expense: expense, people: model.people, currency: model.currency,
            compactShare: isTwoColumn, cadence: cadence(of: expense))
        if isTwoColumn {
            // `ipad-shared`: the expense opens beside the list, its row tinted.
            let selected = selectedExpense?.id == expense.id
            Button {
                selectedExpenseID = expense.id
            } label: {
                row.contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .cardRow()
            .listRowBackground(selected ? PaletteToken.tintSoft.value.color : PennyColor.surface)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityHint("Shows its shares beside the list")
            .accessibilityIdentifier("household.expense.\(expense.id)")
        } else {
            NavigationLink(
                value: DetailRoute.householdExpense(householdID: model.id, expenseID: expense.id)
            ) { row }
            .cardRow()
            .accessibilityIdentifier("household.expense.\(expense.id)")
        }
    }

    /// "Monthly" for an expense a repeating rule added.
    private func cadence(of expense: WireSharedExpense) -> String? {
        guard let id = expense.recurringId, let rule = model.rules.first(where: { $0.id == id }) else { return nil }
        return RecurrenceFrequency(rawValue: rule.frequency).map(SharedFormText.frequency)
    }

    // MARK: Balances

    /// `iphone-shared-balances`: each member's balance under the month and its tag, the month's
    /// suggested payments, then each overdue month with its own payments to record.
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
            monthHeader { settlesTag(recap, month: model.month) }
        }
        suggestionsSection
        overdueSections
    }

    /// The month's suggested payments, or that everyone is settled.
    @ViewBuilder private var suggestionsSection: some View {
        if let recap = model.recap, !recap.suggestions.isEmpty {
            Section {
                ForEach(recap.suggestions, id: \.self) { transfer in
                    suggestionRow(transfer, month: model.month, isOpen: isOpen)
                }
            } header: {
                Text("Suggested payments").cardSectionHeader()
            } footer: {
                monthlyNote
            }
        } else if model.recap != nil, trip == nil || !isTwoColumn {
            Section {
                Text("Everyone is settled for \(HouseholdText.shortMonth(model.month)).")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityIdentifier("household.monthlyNote")
            }
        }
    }

    private var monthlyNote: some View {
        Label {
            if isOpen {
                Text("Record a payment once it has happened outside Penny. Penny doesn't move money.")
            } else {
                Text(
                    "Monthly payments open on the last day of the month. To repay a single expense now, use **Mark as paid** on its share."
                )
            }
        } icon: {
            Image(systemName: isOpen ? "checkmark.circle" : "clock")
        }
        .accessibilityIdentifier("household.monthlyNote")
    }

    /// Each past month still waiting for payments, as its own section: "OCTOBER" with a red
    /// Overdue tag and that month's payments, each with Record paid (`iphone-shared-balances`).
    /// A month whose payments couldn't be read stays a link to that month.
    @ViewBuilder private var overdueSections: some View {
        ForEach(model.overdueRecaps, id: \.month) { recap in
            if let month = MonthKey(recap.month) {
                Section {
                    ForEach(recap.suggestions, id: \.self) { transfer in
                        suggestionRow(transfer, month: month, isOpen: true)
                    }
                } header: {
                    monthHeader(month) {
                        HouseholdTag(text: "Overdue", systemImage: "exclamationmark.circle", tone: .danger)
                    }
                    .accessibilityIdentifier("household.overdue.\(recap.month)")
                }
            }
        }
        let read = Set(model.overdueRecaps.map(\.month))
        let unread = (model.recap?.overdueMonths ?? []).filter { $0 != "\(model.month)" && !read.contains($0) }
        if !unread.isEmpty {
            CardSection("Overdue") {
                ForEach(unread, id: \.self) { month in
                    Button {
                        if let key = MonthKey(month) {
                            Task { await model.show(month: key, current: MonthKey(shell.today)) }
                        }
                    } label: {
                        HStack {
                            Text(MonthKey(month).map(HouseholdText.month) ?? month)
                            Spacer()
                            Text("Overdue").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.danger)
                        }
                    }
                    .accessibilityHint("Shows that month's balances")
                    .accessibilityIdentifier("household.overdue.\(month)")
                }
            }
        }
    }

    private func suggestionRow(_ transfer: WireTransfer, month: MonthKey, isOpen: Bool) -> some View {
        SuggestionRow(
            transfer: transfer, people: model.people, currency: model.currency,
            canRecord: canRecord(transfer), isOpen: isOpen
        ) {
            payment = .monthly(transfer, month: month)
        }
        .accessibilityIdentifier("household.suggestion.\(transfer.fromUserId)-\(transfer.toUserId)")
    }

    /// `ipad-shared`'s Balances card: its title and tag inside, then each member with what they
    /// pay ("pays you $110.40") beside their balance, and the note on when payments open.
    @ViewBuilder private var wideBalancesSection: some View {
        let recap = model.recap
        Section {
            HStack(spacing: 8) {
                Text("Balances").font(.headline)
                Spacer(minLength: 8)
                settlesTag(recap, month: model.month)
            }
            .listRowSeparator(.hidden)
            .accessibilityElement(children: .combine)
            ForEach(recap?.balances ?? [], id: \.userId) { balance in
                WideBalanceRow(
                    balance: balance, people: model.people, currency: model.currency,
                    payments: (recap?.suggestions ?? []).filter { $0.fromUserId == balance.userId },
                    canRecord: canRecord, isOpen: isOpen
                ) { transfer in
                    payment = .monthly(transfer, month: model.month)
                }
                .accessibilityIdentifier("household.balanceRow.\(balance.userId)")
            }
            if recap?.balances.isEmpty ?? true {
                Text("Nobody shared anything this month.").font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            if let recap, !recap.suggestions.isEmpty {
                Text(
                    isOpen
                        ? "Record a payment once it has happened outside Penny. Penny doesn't move money."
                        : "Record paid opens on the last day of the month. Repay a single expense any time with "
                            + "Mark as paid."
                )
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("household.monthlyNote")
            }
        }
    }

    /// `ipad-trip`'s People: everyone on the trip with this month's balance.
    @ViewBuilder private var tripPeopleSection: some View {
        let balances = model.recap?.balances ?? []
        Section {
            ForEach(model.people.current) { member in
                HStack(spacing: 12) {
                    Monogram(initials: model.people.initials(member.userId), size: 30)
                    Text(model.people.name(member.userId)).font(.body).lineLimit(2)
                    Spacer(minLength: 8)
                    MemberBalance(
                        cents: balances.first { $0.userId == member.userId }?.balanceCents ?? 0,
                        currency: model.currency)
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("household.member.\(member.userId)")
            }
        } header: {
            HStack(spacing: 8) {
                Text("People").font(.headline).foregroundStyle(PennyColor.label).textCase(nil)
                Spacer(minLength: 8)
                Text("\(HouseholdText.shortMonth(model.month)) balance").font(.subheadline).textCase(nil)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            .accessibilityElement(children: .combine)
        }
    }

    /// The balances header's tag (`iphone-shared-balances`): amber "Settles Nov 30" while the month
    /// waits for its payments, red Overdue once a past month still has some, green Settled when
    /// nothing is left.
    @ViewBuilder
    private func settlesTag(_ recap: WireMonthRecap?, month: MonthKey) -> some View {
        if let recap, recap.suggestions.isEmpty, !recap.balances.isEmpty {
            HouseholdTag(text: "Settled", systemImage: "checkmark", tone: .income)
        } else if (recap?.overdue ?? false) || (recap?.overdueMonths ?? []).contains("\(month)") {
            HouseholdTag(text: "Overdue", systemImage: "exclamationmark.circle", tone: .danger)
        } else {
            HouseholdTag(text: HouseholdText.settles(month), systemImage: "clock", tone: .pending)
        }
    }

    private var isOpen: Bool {
        SettlementCalendar.monthlyPaymentsOpen(model.month, todayUTC: CalendarDate(shell.now(), in: Self.utc))
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
            Text(people.current.count == 1 ? "1 member" : "\(people.current.count) members").cardSectionHeader()
        } footer: {
            if !canInvite { Text(joiningNote(household)) }
        }
        if canInvite {
            Section {
                InlineInvite(model: model)
            } header: {
                Text("Invite someone").cardSectionHeader()
            } footer: {
                Text(joiningNote(household))
            }
        }
        if !people.former.isEmpty {
            CardSection("Former members") {
                ForEach(people.former) { member in
                    MemberRow(member: member, people: people, isCreator: false)
                        .accessibilityIdentifier("household.member.\(member.userId)")
                }
            }
        }
        // The iPad household has no … menu (`ipad-shared`): its actions close People.
        if isTwoColumn, trip == nil { householdActions }
    }

    // MARK: Confirmations

    private var confirmTitle: String {
        switch confirm {
        case .leave: "Leave \(model.household?.name ?? "this household")?"
        case .archive: "Archive \(model.household?.name ?? "this household")?"
        case .remove(let member): "Remove \(member.email)?"
        case nil: ""
        }
    }

    private func confirmButton(_ confirmation: Confirmation) -> String {
        switch confirmation {
        case .leave: "Leave"
        case .archive: "Archive for everyone"
        case .remove: "Remove"
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
        }
    }
}

// MARK: Rows

/// A shared expense in a household's list (`iphone-shared`): the payer's monogram, the title,
/// "Jo paid · split equally", a green Settled tag once your share is paid and a repeat tag for a
/// repeating expense, then the total over your part of it. A shared trip's list also gives the
/// date, since a trip spans several days.
struct SharedExpenseRow: View {
    let expense: WireSharedExpense
    let people: HouseholdPeople
    let currency: String
    /// A shared trip: the date leads the detail line.
    var showsDate = false
    /// `ipad-shared`: your part reads "$32.10 yours".
    var compactShare = false
    /// The repeating rule's cadence ("Monthly"), when the page knows it.
    var cadence: String?

    var body: some View {
        HStack(spacing: 12) {
            Monogram(initials: people.initials(expense.payerUserId))
            VStack(alignment: .leading, spacing: 2) {
                Text(expense.title).font(.callout.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                if !showsDate, isSettled || expense.recurringId != nil {
                    HStack(spacing: 6) {
                        if isSettled { HouseholdTag(text: "Settled", systemImage: "checkmark", tone: .income) }
                        if expense.recurringId != nil {
                            HouseholdTag(text: cadence ?? "Repeating", systemImage: "repeat")
                        }
                    }
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(
                    expense.totalCents, meaning: .neutral, currency: currency, style: .callout.weight(.semibold))
                Text(viewerLine).font(.footnote).foregroundStyle(viewerColor)
            }
            .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }

    /// Your share of someone else's expense is paid.
    private var isSettled: Bool {
        guard let me = people.meId, me != expense.payerUserId else { return false }
        return expense.status(of: me) == .paid
    }

    private var subtitle: String {
        let payer = expense.payerUserId == people.meId ? "You paid" : "\(people.name(expense.payerUserId)) paid"
        guard showsDate else { return "\(payer) · split \(expense.mode.label.lowercased())" }
        var parts = [HouseholdText.day(expense.date), payer, "split \(expense.mode.label.lowercased())"]
        if expense.recurringId != nil { parts.append("repeating") }
        if let me = people.meId, expense.status(of: me) == .paid { parts.append("Repaid") }
        return parts.joined(separator: " · ")
    }

    private var viewerLine: String {
        guard let me = people.meId else { return "" }
        if compactShare {
            let share = expense.share(of: me)
            return share > 0 ? "\(MoneyFormat.amount(share, currency: currency)) yours" : "no share"
        }
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
            MemberBalance(cents: balance.balanceCents, currency: currency)
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

/// A member's balance as on `iphone-shared-balances`: the semibold signed amount (green when
/// they get money back) over "gets back" or "owes", or Settled.
private struct MemberBalance: View {
    let cents: Int64
    let currency: String

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            if cents == 0 {
                Text("Settled").font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
            } else {
                Text((cents > 0 ? "+" : MoneyFormat.minus) + MoneyFormat.amount(abs(cents), currency: currency))
                    .font(.body.weight(.semibold).monospacedDigit())
                    .foregroundStyle(cents > 0 ? PennyColor.income : PennyColor.label)
                Text(cents > 0 ? "gets back" : "owes").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(HouseholdText.memberBalance(cents, currency: currency))
    }
}

private struct SuggestionRow: View {
    let transfer: WireTransfer
    let people: HouseholdPeople
    let currency: String
    let canRecord: Bool
    /// The month's payments are open (its last day has come): Record paid is the copper action.
    /// Before that it shows, dimmed, as on `iphone-shared-balances`.
    let isOpen: Bool
    let record: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Text(people.name(transfer.fromUserId))
                Image(systemName: "arrow.right").font(.footnote).foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityLabel("pays")
                Text(people.name(transfer.toUserId))
            }
            .font(.body)
            .lineLimit(2)
            Spacer(minLength: 8)
            MoneyText(transfer.amountCents, meaning: .neutral, currency: currency, style: .body.weight(.semibold))
                .fixedSize()
            if canRecord {
                Button("Record paid", action: record)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isOpen ? Color.white : PennyColor.tertiaryLabel)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(isOpen ? PennyColor.tint : PennyColor.fill, in: Capsule())
                    .frame(minHeight: Metrics.minTouchTarget)
                    .buttonStyle(.borderless)
                    .disabled(!isOpen)
                    .fixedSize()
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Record paid") { if canRecord, isOpen { record() } }
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
/// once the creator asks for one (approved, MAZ-256: a new code replaces the one already shared,
/// so opening People never makes one by itself). An unexpired code from this session shows
/// again; the QR code and New code are in the invite sheet (Invite someone).
private struct InlineInvite: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    @State private var working = false
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
                    style: .inline)
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
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .task { model.expireInvite() }
    }

    private func create() async {
        working = true
        defer { working = false }
        failure = await model.newInvite()
    }
}

/// The selected expense beside the list on a wide iPad (`ipad-shared`): its title with who paid
/// and when, then each share with Paid or Mark as paid, and a way to its full page (edit,
/// delete, history).
private struct SelectedExpenseSection: View {
    let expense: WireSharedExpense
    @Bindable var model: HouseholdModel
    let record: (PaymentRequest) -> Void

    var body: some View {
        let people = model.people
        Section {
            ForEach(expense.splits.filter { $0.amountCents > 0 }, id: \.userId) { split in
                HStack(spacing: 12) {
                    Monogram(initials: people.initials(split.userId))
                    Text(
                        split.userId == expense.payerUserId
                            ? "\(people.name(split.userId)) · payer" : people.name(split.userId)
                    )
                    .font(.body)
                    .lineLimit(2)
                    Spacer(minLength: 8)
                    MoneyText(
                        split.amountCents, meaning: .neutral, currency: model.currency, style: .body.weight(.semibold)
                    )
                    .fixedSize()
                    if expense.status(of: split.userId) == .paid {
                        HouseholdTag(text: "Paid", systemImage: "checkmark", tone: .income)
                    } else if expense.canRecordShare(from: split.userId, people: people, archived: model.isArchived) {
                        Button("Mark as paid") { record(.share(expense, from: split.userId)) }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 34)
                            .background(PennyColor.tint, in: Capsule())
                            .buttonStyle(.borderless)
                            .fixedSize()
                            .accessibilityIdentifier("sharedExpense.markPaid.\(split.userId)")
                    }
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("sharedExpense.share.\(split.userId)")
            }
            NavigationLink(value: DetailRoute.householdExpense(householdID: model.id, expenseID: expense.id)) {
                Text("Edit, history and receipt").font(.subheadline)
            }
            .accessibilityIdentifier("household.selectedExpenseOpen")
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text(expense.title).font(.title3.weight(.semibold)).foregroundStyle(PennyColor.label)
                Spacer(minLength: 8)
                Text(
                    "\(people.name(expense.payerUserId)) paid "
                        + "\(MoneyFormat.amount(expense.totalCents, currency: model.currency)) · "
                        + HouseholdText.day(expense.date)
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            .textCase(nil)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("household.selectedExpense")
        }
    }
}

// MARK: Month

/// The household's month in the navigation bar (MAZ-264): "November ⌄" in the label color, as
/// Home's, offering the current month and the eleven before it. `showsYear` gives iPad's
/// "November 2026 ⌄" between its arrows (`ipad-shared`).
struct HouseholdMonthPicker: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    var showsYear = false

    var body: some View {
        let current = MonthKey(shell.today)
        Menu {
            Picker(
                "Month",
                selection: Binding(
                    get: { model.month },
                    set: { month in Task { await model.show(month: month, current: current) } })
            ) {
                ForEach(Self.months(showing: model.month, through: current), id: \.self) { month in
                    Text(MonthPicker.title(month, long: true)).tag(month)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(MonthPicker.title(model.month, long: showsYear))
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(PennyColor.label)
        }
        .tint(PennyColor.label)
        .accessibilityLabel("Month, \(HouseholdText.month(model.month))")
        .accessibilityIdentifier("household.month")
    }

    /// The months the picker offers: the last twelve, plus an older one the page shows (a
    /// notification can open one).
    static func months(showing month: MonthKey, through current: MonthKey) -> [MonthKey] {
        let recent = MonthPicker.months(through: current)
        return recent.contains(month) || month > current ? recent : recent + [month]
    }
}

/// iPad's previous and next month around the pill (`ipad-shared`). Next stops at the current month.
struct HouseholdMonthStep: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: HouseholdModel
    let offset: Int

    var body: some View {
        let current = MonthKey(shell.today)
        let next = model.month.shifted(by: offset).flatMap { $0 > current ? nil : $0 }
        Button {
            if let next { Task { await model.show(month: next, current: current) } }
        } label: {
            Label(
                offset < 0 ? "Previous month" : "Next month",
                systemImage: offset < 0 ? "chevron.backward" : "chevron.forward")
        }
        .tint(PennyColor.label)
        .disabled(next == nil)
        .accessibilityIdentifier(offset < 0 ? "household.previousMonth" : "household.nextMonth")
    }
}

/// A member on `ipad-shared`'s Balances card: the monogram and name, what they pay this month
/// ("pays you $110.40"), and their balance over "owes" or "gets back". Once the month's payments
/// open, each payment the viewer is part of gets Record paid.
private struct WideBalanceRow: View {
    let balance: WireBalance
    let people: HouseholdPeople
    let currency: String
    let payments: [WireTransfer]
    let canRecord: (WireTransfer) -> Bool
    let isOpen: Bool
    let record: (WireTransfer) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Monogram(initials: people.initials(balance.userId), size: 30)
            Text(people.name(balance.userId)).font(.body).lineLimit(2)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                ForEach(payments, id: \.self) { transfer in
                    HStack(spacing: 8) {
                        Text(line(transfer)).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                            .lineLimit(2)
                        if isOpen, canRecord(transfer) {
                            Button("Record paid") { record(transfer) }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 32)
                                .background(PennyColor.tint, in: Capsule())
                                .buttonStyle(.borderless)
                                .fixedSize()
                                .accessibilityIdentifier(
                                    "household.suggestion.\(transfer.fromUserId)-\(transfer.toUserId)")
                        }
                    }
                }
            }
            MemberBalance(cents: balance.balanceCents, currency: currency)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    /// "pays you $110.40", or "pays bea@example.test $18.00".
    private func line(_ transfer: WireTransfer) -> String {
        "pays \(people.object(transfer.toUserId)) \(MoneyFormat.amount(transfer.amountCents, currency: currency))"
    }
}
