import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Recurring (`recurring` and `recurring-paused` cards): schedules by kind, with cadence, next
/// date and account. Tapping a row opens its page; swiping pauses, resumes or removes it
/// (removal asks first); + adds a schedule. Shared schedules the account is part of (MAZ-198)
/// sit with the expenses, marked Shared with the household's name and the account's share, and
/// open their form here (MAZ-256), since the household page lists only the expenses they add.
struct RecurringListView: View {
    @Environment(ShellModel.self) private var shell
    @State private var selection: ScheduleSelection?
    @State private var shared: [SharedSchedule] = []
    @State private var removing: RecurringRule?
    @State private var addingSchedule = false
    @State private var failure: SaveFailure?
    /// A shared schedule being edited, paused or stopped here (MAZ-256).
    @State private var editingShared: SharedSchedule?
    @State private var stopping: SharedSchedule?
    @State private var sharedFailure: HouseholdFailure?

    var body: some View {
        WorkspaceContent { ledger in
            List {
                let items = Self.items(ledger.recurring, shared: shared)
                if !items.isEmpty {
                    // The card's subtitle, right under the large title (`.lsub`). A navigation
                    // subtitle would fold the large title into an inline one.
                    Section {
                        Text(Self.subtitle).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                    .compactSectionSpacing()
                }
                if let failure {
                    Section {
                        SaveErrorBanner(failure: failure, retry: nil)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                if let sharedFailure {
                    Section {
                        HouseholdFailureBanner(failure: sharedFailure)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                let kinds = Self.sectionOrder.filter { kind in items.contains { $0.kind == kind } }
                ForEach(kinds, id: \.self) { kind in
                    Section {
                        ForEach(Self.sorted(items.filter { $0.kind == kind })) { item in
                            switch item {
                            case .personal(let rule): row(rule, ledger: ledger)
                            case .shared(let schedule): sharedRow(schedule)
                            }
                        }
                    } header: {
                        // The card's group heading (`.gh`): small, semibold, upper case.
                        Text(Self.sectionTitle(kind)).cardSectionHeader()
                    } footer: {
                        if kind == kinds.last { Text(Self.footer(hasShared: !shared.isEmpty)) }
                    }
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.recurring.isEmpty && shared.isEmpty {
                    PennyStateView(
                        .empty, title: "No recurring entries",
                        message: "Pay, rent and subscriptions you repeat show up here with their next date.",
                        actionTitle: "Add schedule"
                    ) { addingSchedule = true }
                }
            }
            .sheet(isPresented: $addingSchedule) {
                ScheduleFormSheet(today: shell.today, categories: ledger.categories).environment(shell)
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Recurring")
        // The card's large title; Settings' sheet root is inline, and a pushed page would inherit it.
        .toolbarTitleDisplayModeLarge()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add schedule", systemImage: "plus") { addingSchedule = true }
                    .neutralToolbarGlyph()
                    .disabled(shell.workspace.load.ledger == nil)
                    .accessibilityIdentifier("recurring.add")
            }
        }
        .navigationDestination(item: $selection) { ScheduleDetailView(id: $0.id) }
        .confirmationDialog(
            "Remove this schedule?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible, presenting: removing
        ) { rule in
            Button("Remove schedule", role: .destructive) { run(ScheduleActions.remove(rule)) }
                .accessibilityIdentifier("recurring.removeConfirm")
        } message: { rule in
            Text("Future entries for \(rule.title) stop. Entries already recorded stay in your activity.")
        }
        .confirmationDialog(
            "Stop repeating \(stopping?.rule.title ?? "this expense")?",
            isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }),
            titleVisibility: .visible, presenting: stopping
        ) { schedule in
            Button("Stop repeating", role: .destructive) { Task { await stop(schedule) } }
                .accessibilityIdentifier("sharedSchedule.removeConfirm")
        } message: { schedule in
            Text("No more expenses are added to \(schedule.household.name) from it. Expenses it already added stay.")
        }
        .sheet(item: $editingShared, onDismiss: { Task { shared = await shell.households.sharedSchedules() } }) {
            schedule in
            SharedScheduleEditor(schedule: schedule).environment(shell)
        }
        .task { shared = await shell.households.sharedSchedules() }
        .accessibilityIdentifier("screen.recurring")
    }

    private func sharedRow(_ schedule: SharedSchedule) -> some View {
        Button {
            editingShared = schedule
        } label: {
            SharedScheduleRow(schedule: schedule, today: shell.today)
        }
        .buttonStyle(.plain)
        // Edited here: the household's page lists the expenses a schedule adds, not the schedules.
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Stop repeating", systemImage: "trash", role: .destructive) { stopping = schedule }
                .accessibilityIdentifier("sharedSchedule.\(schedule.rule.id).remove")
            Button(
                schedule.rule.active ? "Pause" : "Resume",
                systemImage: schedule.rule.active ? "pause.fill" : "play.fill"
            ) { Task { await setActive(schedule, !schedule.rule.active) } }
            .tint(PennyColor.pending)
            .accessibilityIdentifier("sharedSchedule.\(schedule.rule.id).toggle")
        }
        .cardRow()
        .accessibilityHint("Opens the repeating expense")
        .accessibilityIdentifier("sharedSchedule.\(schedule.rule.id)")
    }

    private func setActive(_ schedule: SharedSchedule, _ active: Bool) async {
        guard let model = shell.households.model(for: schedule.household.id) else { return }
        sharedFailure = await model.setActive(schedule.rule, active)
        shared = await shell.households.sharedSchedules()
    }

    private func stop(_ schedule: SharedSchedule) async {
        guard let model = shell.households.model(for: schedule.household.id) else { return }
        sharedFailure = await model.deleteRule(schedule.rule)
        shared = await shell.households.sharedSchedules()
    }

    private func row(_ rule: RecurringRule, ledger: Ledger) -> some View {
        Button {
            selection = ScheduleSelection(id: rule.id)
        } label: {
            ScheduleRow(rule: rule, ledger: ledger, today: shell.today)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Remove", systemImage: "trash", role: .destructive) { removing = rule }
                .accessibilityIdentifier("schedule.\(rule.id).remove")
            Button(
                rule.active ? "Pause" : "Resume", systemImage: rule.active ? "pause.fill" : "play.fill"
            ) { run(ScheduleActions.toggle(rule, today: shell.today)) }
            .tint(PennyColor.pending)
            .accessibilityIdentifier("schedule.\(rule.id).toggle")
        }
        .cardRow()
        .accessibilityHint("Opens the schedule")
        .accessibilityIdentifier("schedule.\(rule.id)")
    }

    private func run(_ action: (LedgerChange, ChangeSummary)) {
        Task { failure = await shell.commit(action.0, summary: action.1) }
    }

    /// Personal schedules and the shared ones, which are always expenses.
    static func items(_ rules: [RecurringRule], shared: [SharedSchedule]) -> [ScheduleItem] {
        rules.map(ScheduleItem.personal) + shared.map(ScheduleItem.shared)
    }

    /// Active schedules by next date, then paused ones.
    static func sorted(_ rules: [RecurringRule]) -> [RecurringRule] {
        sorted(rules.map(ScheduleItem.personal)).compactMap(\.personal)
    }

    /// Active schedules by next date, then paused ones; shared and personal together.
    static func sorted(_ items: [ScheduleItem]) -> [ScheduleItem] {
        items.sorted { lhs, rhs in
            if lhs.active != rhs.active { return lhs.active }
            if lhs.nextDate != rhs.nextDate { return lhs.nextDate < rhs.nextDate }
            return lhs.title < rhs.title
        }
    }

    static let subtitle = "Penny records these on their date."

    /// The card's order: Income, then Expenses, then Investments.
    static let sectionOrder: [EntryKind] = [.income, .expense, .investment]

    static func footer(hasShared: Bool) -> String {
        let personal = "Swipe a schedule to pause or remove it. Removing keeps past entries."
        return hasShared ? personal + " Shared schedules count only your share; open one to change it." : personal
    }

    static func sectionTitle(_ kind: EntryKind) -> String { OrganizeText.kindPlural(kind) }
}

extension View {
    /// No gap after this section, so the subtitle stays with the title (iOS only; the macOS
    /// host build used for package tests has no section spacing).
    @ViewBuilder
    func compactSectionSpacing() -> some View {
        #if os(iOS)
            listSectionSpacing(0)
        #else
            self
        #endif
    }
}

/// The schedule a row opened.
struct ScheduleSelection: Hashable {
    let id: String
}

/// A row on Recurring: one of the account's schedules, or a household's it shares (MAZ-198).
enum ScheduleItem: Identifiable {
    case personal(RecurringRule)
    case shared(SharedSchedule)

    var id: String {
        switch self {
        case .personal(let rule): rule.id
        case .shared(let schedule): "shared:\(schedule.rule.id)"
        }
    }

    var kind: EntryKind {
        switch self {
        case .personal(let rule): rule.kind
        case .shared: .expense
        }
    }

    var active: Bool {
        switch self {
        case .personal(let rule): rule.active
        case .shared(let schedule): schedule.rule.active
        }
    }

    /// A shared rule whose date can't be read sorts last.
    var nextDate: CalendarDate {
        switch self {
        case .personal(let rule): rule.nextDate
        case .shared(let schedule): schedule.nextDate ?? .latest
        }
    }

    var title: String {
        switch self {
        case .personal(let rule): rule.title
        case .shared(let schedule): schedule.rule.title
        }
    }

    var personal: RecurringRule? {
        if case .personal(let rule) = self { return rule }
        return nil
    }
}

private struct ScheduleRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let rule: RecurringRule
    let ledger: Ledger
    let today: CalendarDate

    var body: some View {
        let category = ledger.category(id: rule.categoryId)
        let account = rule.accountId.flatMap(ledger.account(id:))
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) : AnyLayout(HStackLayout(spacing: 12))
        layout {
            HStack(spacing: 12) {
                CategoryIcon(symbol: ScheduleText.tileSymbol(rule.kind, category: category), color: tint(category))
                    .opacity(rule.active ? 1 : 0.5)
                VStack(alignment: .leading, spacing: 1) {
                    Text(rule.title).font(.callout.weight(.semibold))
                        .foregroundStyle(rule.active ? PennyColor.label : PennyColor.secondaryLabel)
                        .lineLimit(3)
                    if rule.active {
                        // One line when it fits; otherwise the account on its own line, never a
                        // wrap that strands "· Everyday chequing".
                        ViewThatFits(in: .horizontal) {
                            Text(ScheduleText.row(rule, account: account, today: today)).lineLimit(1)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ScheduleText.timing(rule, today: today))
                                if let account { Text(account.name) }
                            }
                        }
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    } else {
                        ScheduleTag(ScheduleText.row(rule, account: account, today: today), systemImage: "pause.fill")
                    }
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 8) {
                ScheduleAmount(
                    cents: rule.share, meaning: ScheduleText.sign(rule.kind), active: rule.active,
                    currency: ledger.currency.rawValue)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Income and investments take their meaning color, as on the cards; expenses their category's.
    private func tint(_ category: LedgerCategory?) -> Color {
        EntryText.tileColor(rule.kind, category: category, id: rule.categoryId)
    }
}

/// A shared schedule's row: the household's name where a personal row shows the account, a
/// Shared badge, and the account's share of the next occurrence labelled "your share".
private struct SharedScheduleRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let schedule: SharedSchedule
    let today: CalendarDate

    var body: some View {
        let rule = schedule.rule
        let detail = ScheduleText.sharedRow(schedule, today: today)
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) : AnyLayout(HStackLayout(spacing: 12))
        layout {
            HStack(spacing: 12) {
                CategoryIcon(symbol: CategoryStyle.symbol(forIonicon: rule.category.icon), color: rule.category.tint)
                    .opacity(rule.active ? 1 : 0.5)
                VStack(alignment: .leading, spacing: 1) {
                    // The badge rides on the title's line, so the row stays two lines like a
                    // personal one; it drops below only when the title leaves no room.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            title(rule).lineLimit(1)
                            ScheduleTag("Shared", systemImage: "person.2.fill").fixedSize()
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            title(rule).lineLimit(3)
                            ScheduleTag("Shared", systemImage: "person.2.fill")
                        }
                    }
                    if rule.active {
                        // One line when it fits; otherwise the household's name on its own line,
                        // never a wrap that strands "· Maison".
                        ViewThatFits(in: .horizontal) {
                            Text(detail).lineLimit(1)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ScheduleText.sharedTiming(schedule, today: today))
                                Text(schedule.household.name)
                            }
                        }
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    } else {
                        ScheduleTag(detail, systemImage: "pause.fill")
                    }
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 8) {
                VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                    ScheduleAmount(
                        cents: schedule.shareCents, meaning: .expense, active: rule.active,
                        currency: schedule.household.currency)
                    // The card's caption under an amount (`.row .amt span`).
                    Text("your share").font(.caption.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func title(_ rule: WireSharedRule) -> some View {
        Text(rule.title).font(.callout.weight(.semibold))
            .foregroundStyle(rule.active ? PennyColor.label : PennyColor.secondaryLabel)
    }
}

/// The card's `.tag`: a small glyph and 12-point semibold words on the fill, in a rounded
/// rectangle. "Paused · monthly" under a paused schedule's title, and "Shared" beside a
/// shared one's, in words and never color alone.
private struct ScheduleTag: View {
    @ScaledMetric(relativeTo: .caption) private var glyph = 9.0
    let text: String
    let systemImage: String

    init(_ text: String, systemImage: String) {
        self.text = text
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage).font(.system(size: glyph, weight: .bold)).accessibilityHidden(true)
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(PennyColor.secondaryLabel)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A schedule's amount on Recurring, signed by its kind as the card shows it: a paused
/// schedule keeps its sign and is muted.
private struct ScheduleAmount: View {
    let cents: Int64
    let meaning: MoneyMeaning
    let active: Bool
    let currency: String

    var body: some View {
        Text(MoneyFormat.signed(cents, meaning: meaning, currency: currency))
            .font(.callout.weight(.semibold).monospacedDigit())
            .foregroundStyle(active ? meaning.color : PennyColor.secondaryLabel)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityLabel(MoneyFormat.spoken(cents, meaning: meaning, currency: currency))
    }
}

/// A schedule's page (`schedule-detail` card): what it records and when, the next dates, the
/// category and account, Edit and a separate Pause/Resume, and Remove with its own
/// confirmation (`remove-schedule`). Removing keeps the entries it already recorded. The bar
/// has no title (the hero leads with the name) and a … menu with the same three actions.
struct ScheduleDetailView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var editing = false
    @State private var confirmingRemoval = false
    @State private var failure: SaveFailure?

    var body: some View {
        WorkspaceContent { ledger in
            if let rule = ledger.rule(id: id) {
                content(rule, ledger: ledger)
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) { moreMenu(rule) }
                    }
                    .sheet(isPresented: $editing) { ScheduleFormSheet(rule: rule).environment(shell) }
                    .confirmationDialog(
                        "Remove \(rule.title)?", isPresented: $confirmingRemoval, titleVisibility: .visible
                    ) {
                        Button("Remove schedule", role: .destructive) { remove(rule) }
                            .accessibilityIdentifier("schedule.removeConfirm")
                        Button("Keep schedule", role: .cancel) {}
                    } message: {
                        Text(ScheduleActions.removalMessage)
                    }
            } else {
                PennyStateView(
                    .empty, title: "Schedule removed",
                    message: "This schedule was removed, here or on another device. Its past entries stay in Activity.")
            }
        }
        .background(PennyColor.background)
        .navigationTitle(shell.workspace.load.ledger?.rule(id: id)?.title ?? "Schedule")
        .inlineNavigationTitle()
        .toolbar {
            // `iphone-schedule-detail`: no title over the hero, which already leads with the name.
            ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
        }
        .accessibilityIdentifier("screen.schedule")
    }

    private func content(_ rule: RecurringRule, ledger: Ledger) -> some View {
        let category = ledger.category(id: rule.categoryId)
        let account = rule.accountId.flatMap(ledger.account(id:))
        let currency = ledger.currency.rawValue
        return List {
            Section {
                VStack(spacing: 10) {
                    CategoryIcon(
                        symbol: CategoryStyle.symbol(forIonicon: category?.icon ?? "repeat"),
                        color: PennyColor.category(category?.paletteColor ?? .other), size: 64)
                    Text(rule.title).font(.title2.weight(.bold)).multilineTextAlignment(.center)
                    MoneyText(
                        rule.share, meaning: ScheduleText.meaning(rule), currency: currency,
                        style: .largeTitle.weight(.bold))
                    Text(ScheduleText.cadence(rule)).font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel).multilineTextAlignment(.center)
                        .accessibilityIdentifier("schedule.cadence")
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                actions(rule)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if !rule.active {
                Section {
                    StatusBanner(
                        tone: .info, title: "Paused",
                        message: "Penny won't record this schedule until you resume it. "
                            + "Resuming skips the dates you missed."
                    )
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("schedule.pausedBanner")
                }
            }
            if let failure {
                Section {
                    SaveErrorBanner(failure: failure, retry: nil)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
            }
            Section {
                let dates = Self.upcoming(rule, ledger: ledger, today: shell.today)
                ForEach(Array(dates.enumerated()), id: \.offset) { index, date in
                    HStack {
                        Text(Self.longDate(date, today: shell.today))
                        Spacer()
                        if index == 0 {
                            Text(ScheduleText.relative(date, today: shell.today)).font(.footnote)
                                .foregroundStyle(PennyColor.secondaryLabel)
                        }
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text(rule.active ? "Next" : "If you resume today").cardSectionHeader()
            }
            CardSection("Details") {
                LabeledContent("Category") {
                    HStack(spacing: 6) {
                        Circle().fill(PennyColor.category(category?.paletteColor ?? .other)).frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        Text(category?.name ?? "Removed")
                    }
                }
                LabeledContent("Account", value: account?.name ?? "None")
                if rule.share != rule.total {
                    LabeledContent("Receipt total") {
                        MoneyText(rule.total, meaning: .neutral, currency: currency, style: .body)
                    }
                }
                LabeledContent("Started", value: DayText.date(rule.date).formatted(.dateTime.month().day().year()))
                if !rule.note.isEmpty {
                    LabeledContent("Note", value: rule.note)
                }
            }
            Section {
                Button(role: .destructive) {
                    confirmingRemoval = true
                } label: {
                    Text("Remove schedule").frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                }
                .accessibilityIdentifier("schedule.remove")
            } footer: {
                Text("Past entries stay in your activity.").frame(maxWidth: .infinity)
            }
        }
        .insetGroupedList()
    }

    private func moreMenu(_ rule: RecurringRule) -> some View {
        Menu {
            Button("Edit", systemImage: "square.and.pencil") { editing = true }
            Button(
                rule.active ? "Pause" : "Resume", systemImage: rule.active ? "pause" : "play"
            ) { toggle(rule) }
            Button("Remove schedule", systemImage: "trash", role: .destructive) { confirmingRemoval = true }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        .neutralToolbarGlyph()
        .accessibilityIdentifier("schedule.more")
    }

    private func toggle(_ rule: RecurringRule) {
        let (change, summary) = ScheduleActions.toggle(rule, today: shell.today)
        Task { failure = await shell.commit(change, summary: summary) }
    }

    private func actions(_ rule: RecurringRule) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { actionButtons(rule) }
            VStack(spacing: 12) { actionButtons(rule) }
        }
    }

    @ViewBuilder
    private func actionButtons(_ rule: RecurringRule) -> some View {
        PennyButton("Edit", systemImage: "square.and.pencil") { editing = true }
            .accessibilityIdentifier("schedule.edit")
        PennyButton(
            rule.active ? "Pause" : "Resume", systemImage: rule.active ? "pause.fill" : "play.fill", role: .secondary
        ) { toggle(rule) }
        .accessibilityIdentifier("schedule.toggleActive")
    }

    private func remove(_ rule: RecurringRule) {
        let (change, summary) = ScheduleActions.remove(rule)
        Task {
            failure = await shell.commit(change, summary: summary)
            if failure == nil { dismiss() }
        }
    }

    /// The next three dates; for a paused schedule, the dates it would have if resumed today.
    static func upcoming(_ rule: RecurringRule, ledger: Ledger, today: CalendarDate) -> [CalendarDate] {
        guard !rule.active else { return rule.upcomingDates(3) }
        let resumed = try? LedgerChange.setScheduleActive(id: rule.id, active: true, today: today).apply(to: ledger)
        return resumed?.rule(id: rule.id)?.upcomingDates(3) ?? []
    }

    /// "Tue, Nov 18", as the card lists the next dates, into the next year too ("Sun, Jan 18").
    /// A date a year or more away (a yearly schedule's) adds its year: "Thu, Nov 18, 2027".
    static func longDate(_ date: CalendarDate, today: CalendarDate) -> String {
        let format = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
        return DayText.date(date).formatted(date.days(since: today) < 365 ? format : format.year())
    }
}

/// A shared schedule's form, opened from Recurring (MAZ-256): its household is read first, so
/// the form knows the members and the viewer's part.
private struct SharedScheduleEditor: View {
    @Environment(ShellModel.self) private var shell
    let schedule: SharedSchedule
    @State private var model: HouseholdModel?

    var body: some View {
        Group {
            if let model, model.household != nil {
                SharedExpenseFormSheet(request: .rule(schedule.rule), model: model)
            } else if let failure = model?.load.failure {
                PennyStateView(.error, title: "Couldn't open \(schedule.household.name)", message: failure.message)
            } else {
                PennyStateView(.loading, title: "Opening \(schedule.household.name)…")
            }
        }
        .task {
            guard let loaded = shell.households.model(for: schedule.household.id) else { return }
            if loaded.household == nil { await loaded.refresh() }
            model = loaded
        }
    }
}
