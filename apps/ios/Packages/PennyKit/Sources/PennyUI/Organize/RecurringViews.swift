import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Recurring (`recurring` and `recurring-paused` cards): personal schedules by kind, with
/// cadence, next date and account. Tapping a row opens its page; swiping pauses, resumes or
/// removes it (removal asks first); + adds a schedule.
struct RecurringListView: View {
    @Environment(ShellModel.self) private var shell
    @State private var selection: ScheduleSelection?
    @State private var removing: RecurringRule?
    @State private var addingSchedule = false
    @State private var failure: SaveFailure?

    var body: some View {
        WorkspaceContent { ledger in
            List {
                if let failure {
                    Section {
                        SaveErrorBanner(failure: failure, retry: nil)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                let kinds = EntryKind.allCases.filter { kind in ledger.recurring.contains { $0.kind == kind } }
                ForEach(kinds, id: \.self) { kind in
                    Section {
                        ForEach(Self.sorted(ledger.recurring.filter { $0.kind == kind }), id: \.id) { rule in
                            row(rule, ledger: ledger)
                        }
                    } header: {
                        Text(Self.sectionTitle(kind))
                    } footer: {
                        if kind == kinds.last {
                            Text("Swipe a schedule to pause or remove it. Removing keeps past entries.")
                        }
                    }
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.recurring.isEmpty {
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
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add schedule", systemImage: "plus") { addingSchedule = true }
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
        .accessibilityIdentifier("screen.recurring")
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
        .accessibilityHint("Opens the schedule")
        .accessibilityIdentifier("schedule.\(rule.id)")
    }

    private func run(_ action: (LedgerChange, ChangeSummary)) {
        Task { failure = await shell.commit(action.0, summary: action.1) }
    }

    /// Active schedules by next date, then paused ones.
    static func sorted(_ rules: [RecurringRule]) -> [RecurringRule] {
        rules.sorted { lhs, rhs in
            if lhs.active != rhs.active { return lhs.active }
            if lhs.nextDate != rhs.nextDate { return lhs.nextDate < rhs.nextDate }
            return lhs.title < rhs.title
        }
    }

    static func sectionTitle(_ kind: EntryKind) -> String { OrganizeText.kindPlural(kind) }
}

/// The schedule a row opened.
struct ScheduleSelection: Hashable {
    let id: String
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
                CategoryIcon(
                    symbol: CategoryStyle.symbol(forIonicon: category?.icon ?? "repeat"),
                    color: PennyColor.category(category?.paletteColor ?? .other)
                )
                .opacity(rule.active ? 1 : 0.55)
                VStack(alignment: .leading, spacing: 3) {
                    Text(rule.title).font(.body.weight(.semibold))
                        .foregroundStyle(rule.active ? PennyColor.label : PennyColor.secondaryLabel)
                        .lineLimit(3)
                    if rule.active {
                        Text(ScheduleText.row(rule, account: account, today: today))
                            .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    } else {
                        Label(ScheduleText.row(rule, account: account, today: today), systemImage: "pause.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(PennyColor.secondaryLabel)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(PennyColor.fill, in: Capsule())
                    }
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 8) {
                MoneyText(rule.share, meaning: ScheduleText.meaning(rule), currency: ledger.currency.rawValue)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: ControlSize.row)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A schedule's page (`schedule` card): what it records and when, the next dates, the
/// category and account, Edit and a separate Pause/Resume, and Remove with its own
/// confirmation (`remove-schedule`). Removing keeps the entries it already recorded.
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
                actions(rule)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
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
                        Text(Self.longDate(date))
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
                Text(rule.active ? "Next" : "If you resume today")
            }
            Section("Details") {
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
        ) {
            let (change, summary) = ScheduleActions.toggle(rule, today: shell.today)
            Task { failure = await shell.commit(change, summary: summary) }
        }
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

    static func longDate(_ date: CalendarDate) -> String {
        DayText.date(date).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
    }
}
