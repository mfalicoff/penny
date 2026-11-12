import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Words for the shared expense form.
enum SharedFormText {
    static func frequency(_ frequency: RecurrenceFrequency) -> String {
        switch frequency {
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }
}

/// Add or edit a shared expense or a repeating one (`iphone-shared-expense-add`, the redesign's
/// `shared-expense`, `shared-split` and `shared-payer`): amount, name, category, who paid, the
/// split (equally, by amount, by percent) with each share and "your share", date, the payer's
/// own account, repeat and note.
///
/// Payer privacy: the account row appears only when the viewer pays, lists only the viewer's
/// own accounts, and is never sent for someone else; other members never see it. Online only:
/// a failed save keeps everything as typed with the reason, a stale edit offers Review latest,
/// and closing with changes asks first. A draft kept for later comes back with its focus.
struct SharedExpenseFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let request: SharedFormRequest
    let model: HouseholdModel

    @State private var form: SharedExpenseFormModel?
    @State private var restored = false

    var body: some View {
        Group {
            if let form {
                SharedExpenseForm(form: form, model: model, restored: $restored, close: close)
            } else {
                ProgressView()
            }
        }
        .onAppear {
            guard form == nil else { return }
            let (draft, wasKept) = initialDraft()
            form = SharedExpenseFormModel(draft: draft, household: model)
            restored = wasKept
        }
    }

    private func close() { dismiss() }

    private func initialDraft() -> (SharedExpenseDraft, Bool) {
        let viewerId = model.people.meId
        let fresh: SharedExpenseDraft
        switch request {
        case .new:
            let categories = shell.workspace.load.ledger?.categories.filter { $0.kind == .expense } ?? []
            fresh = SharedExpenseDraft(
                householdId: model.id, payerId: viewerId ?? "", today: Self.defaultDate(model.month, shell.today),
                category: categories.first.map(WireSharedCategory.init) ?? .other)
        case .expense(let expense):
            fresh = SharedExpenseDraft(editing: expense, viewerId: viewerId)
        case .rule(let rule):
            fresh = SharedExpenseDraft(editing: rule, viewerId: viewerId)
        }
        if let kept = model.directory?.drafts[fresh.key], kept.original?.revision == fresh.original?.revision {
            return (kept, true)
        }
        return (fresh, false)
    }

    /// Today in the current month; the first of a past month the page shows.
    static func defaultDate(_ month: MonthKey, _ today: CalendarDate) -> CalendarDate {
        month.contains(today) || month > MonthKey(today) ? today : month.last
    }
}

private struct SharedExpenseForm: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var form: SharedExpenseFormModel
    let model: HouseholdModel
    @Binding var restored: Bool
    let close: () -> Void

    @FocusState private var focus: SharedExpenseDraft.Field?
    @State private var confirmingClose = false
    @State private var saved = false
    @State private var discarded = false

    var body: some View {
        NavigationStack {
            Form {
                banners
                amountSection
                payerSection
                splitSection
                detailsSection
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .navigationTitle(title)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        if form.hasChanges { confirmingClose = true } else { close() }
                    }
                    .disabled(form.isSaving)
                    .accessibilityIdentifier("sharedForm.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if form.isSaving { ProgressView() } else { Label("Save", systemImage: "checkmark") }
                    }
                    .disabled(form.isSaving || form.isStale)
                    .accessibilityIdentifier("sharedForm.save")
                }
            }
            .confirmationDialog("Keep your changes?", isPresented: $confirmingClose, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) {
                    discarded = true
                    form.discardDraft()
                    close()
                }
                Button("Keep as draft") {
                    form.keepDraft()
                    discarded = true
                    close()
                }
                .accessibilityIdentifier("sharedForm.keepDraft")
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("A kept draft comes back the next time you add or edit this expense, until Penny closes.")
            }
        }
        .interactiveDismissDisabled(form.hasChanges || form.isSaving)
        .sensoryFeedback(.error, trigger: form.refusedCount)
        .onAppear {
            if restored { focus = form.draft.focus ?? .amount } else if form.draft.original == nil { focus = .amount }
        }
        .onChange(of: focus) { if let focus { form.draft.focus = focus } }
        .onDisappear {
            // Replaced by a link or closed some other way: keep what was typed for this session.
            if !saved, form.saved == nil, !discarded, form.hasChanges { form.keepDraft() }
        }
        .accessibilityIdentifier("screen.sharedExpenseForm")
    }

    private var title: String {
        switch form.draft.original {
        case .expense: "Edit expense"
        case .rule: "Edit repeating expense"
        case nil: form.draft.repeats == nil ? "New expense" : "New repeating expense"
        }
    }

    private var participants: [WireHouseholdMember] { form.participants }
    private var locked: Bool { form.draft.isPaidExpense }
    private var viewerId: String? { form.viewerId }

    private func save() async {
        if await form.save() != nil {
            saved = true
            restored = false
            close()
        }
    }

    // MARK: Sections

    @ViewBuilder private var banners: some View {
        if restored {
            Section {
                HStack {
                    Text("Your unsaved expense is back").font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("sharedForm.restoredDraft")
                    Spacer()
                    Button("Discard", role: .destructive) {
                        form.discardDraft()
                        discarded = true
                        restored = false
                        close()
                    }
                    .accessibilityIdentifier("sharedForm.discard")
                }
            }
        }
        if let failure = form.failure {
            Section {
                StatusBanner(
                    tone: failure.kind == .offline ? .offline : .error,
                    title: form.isStale ? "Changed by someone else" : HouseholdFailureBanner.title(failure.kind),
                    message: form.isStale
                        ? (form.latest == nil
                            ? "It was deleted after you opened it. Nothing was saved."
                            : "Someone changed it after you opened it. Nothing was saved; review the latest version.")
                        : failure.message + (failure.canRetry ? " Your changes are kept." : "")
                )
                .accessibilityIdentifier("sharedForm.error")
                if form.isStale, form.latest != nil {
                    Button("Review latest") {
                        _ = form.reviewLatest()
                        restored = false
                    }
                    .accessibilityIdentifier("sharedForm.reviewLatest")
                } else if failure.canRetry {
                    Button("Try again") { Task { await save() } }
                }
            }
            .listRowBackground(Color.clear)
        }
        if let problem = form.problem {
            Section {
                Label(
                    problem.message(money: HouseholdText.money(model.currency)), systemImage: "exclamationmark.circle"
                )
                .foregroundStyle(PennyColor.danger)
                .font(.subheadline)
                .accessibilityIdentifier("sharedForm.problem")
            }
        }
    }

    @ViewBuilder private var amountSection: some View {
        Section {
            TextField("0.00", text: $form.draft.amountText)
                .font(.largeTitle.weight(.bold).monospacedDigit())
                .amountEntry()
                .focused($focus, equals: .amount)
                .disabled(locked)
                .accessibilityLabel("Total amount, \(model.currency)")
                .accessibilityIdentifier("sharedForm.amount")
            TextField("What was it for?", text: $form.draft.title)
                .focused($focus, equals: .title)
                .submitLabel(.done)
                .accessibilityIdentifier("sharedForm.title")
            Picker("Category", selection: $form.draft.category) {
                ForEach(categories, id: \.self) { category in
                    Label(category.name, systemImage: category.symbol).tag(category)
                }
            }
            .accessibilityIdentifier("sharedForm.category")
        } header: {
            Text(model.household?.name ?? "Shared")
        } footer: {
            if locked {
                Text(
                    "Someone has repaid a share, so the total, payer, month and shares stay as they are. The name, "
                        + "category, note and day can still change.")
            }
        }
    }

    /// The ledger's expense categories, plus the expense's own when the ledger doesn't have it.
    private var categories: [WireSharedCategory] {
        var list = (shell.workspace.load.ledger?.categories.filter { $0.kind == .expense } ?? [])
            .map(WireSharedCategory.init)
        if !list.contains(form.draft.category) { list.insert(form.draft.category, at: 0) }
        if list.isEmpty { list = [.other] }
        return list
    }

    @ViewBuilder private var payerSection: some View {
        Section("Paid by") {
            ForEach(participants) { member in
                Button {
                    form.draft.choosePayer(member.userId, viewerId: viewerId)
                } label: {
                    HStack(spacing: 12) {
                        Monogram(initials: model.people.initials(member.userId))
                        Text(model.people.name(member.userId)).foregroundStyle(PennyColor.label)
                        Spacer()
                        if form.draft.payerId == member.userId {
                            Image(systemName: "checkmark").foregroundStyle(PennyColor.tint)
                        }
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                }
                .disabled(locked)
                .accessibilityAddTraits(form.draft.payerId == member.userId ? .isSelected : [])
                .accessibilityIdentifier("sharedForm.payer.\(member.userId)")
            }
            if participants.isEmpty {
                Text("Nobody was a member on that date. Choose another date.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
    }

    @ViewBuilder private var splitSection: some View {
        let preview = form.draft.preview(participants: participants)
        Section {
            Picker(
                "Split",
                selection: Binding(
                    get: { form.draft.mode }, set: { form.draft.switchMode($0, participants: participants) })
            ) {
                Text("Equally").tag(SharedSplitMode.equal)
                Text("Amounts").tag(SharedSplitMode.exact)
                Text("Percent").tag(SharedSplitMode.percent)
            }
            .pickerStyle(.segmented)
            .disabled(locked)
            .accessibilityIdentifier("sharedForm.mode")
            ForEach(participants) { member in
                splitRow(member, preview: preview)
                    .accessibilityIdentifier("sharedForm.split.\(member.userId)")
            }
            HStack {
                Text("Your share · in your spending").font(.subheadline.weight(.semibold))
                Spacer()
                if let share = form.viewerShare {
                    MoneyText(share, meaning: .expense, currency: model.currency)
                } else {
                    Text("—").foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("sharedForm.yourShare")
        } header: {
            Text("Split")
        } footer: {
            if case .failure(let problem) = preview, form.draft.totalCents != nil {
                Text(problem.message(money: HouseholdText.money(model.currency)))
            } else {
                Text(
                    "Only your share counts in your spending. Splits include the members on the expense's date; "
                        + "the server rounds leftover cents the same way.")
            }
        }
    }

    @ViewBuilder
    private func splitRow(_ member: WireHouseholdMember, preview: Result<[SharedShare], SharedExpenseDraft.Problem>)
        -> some View
    {
        let share = (try? preview.get())?.first { $0.userId == member.userId }?.amountCents
        HStack(spacing: 12) {
            Monogram(initials: model.people.initials(member.userId))
            Text(model.people.name(member.userId))
            Spacer(minLength: 8)
            switch form.draft.mode {
            case .equal:
                Text(share.map { MoneyFormat.amount($0, currency: model.currency) } ?? "—")
                    .monospacedDigit()
            case .exact:
                TextField("0.00", text: binding(\.exactTexts, member.userId))
                    .amountEntry()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120)
                    .focused($focus, equals: .split)
                    .disabled(locked)
                    .accessibilityLabel("\(model.people.name(member.userId))'s share")
            case .percent:
                TextField("0", text: binding(\.percentTexts, member.userId))
                    .amountEntry()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80)
                    .focused($focus, equals: .split)
                    .disabled(locked)
                    .accessibilityLabel("\(model.people.name(member.userId))'s percentage")
                Text("%").foregroundStyle(PennyColor.secondaryLabel)
                Text(share.map { MoneyFormat.amount($0, currency: model.currency) } ?? "")
                    .font(.footnote.monospacedDigit()).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
    }

    private func binding(_ path: WritableKeyPath<SharedExpenseDraft, [String: String]>, _ id: String)
        -> Binding<String>
    {
        Binding(get: { form.draft[keyPath: path][id] ?? "" }, set: { form.draft[keyPath: path][id] = $0 })
    }

    @ViewBuilder private var detailsSection: some View {
        Section {
            DatePicker(
                form.draft.isRule ? "Next date" : "Date",
                selection: Binding(
                    get: { DayText.date(form.draft.date) },
                    set: { form.draft.date = CalendarDate($0, in: Calendar(identifier: .gregorian)) }),
                in: DayText.date(.earliest)...DayText.date(.latest), displayedComponents: .date
            )
            .accessibilityIdentifier("sharedForm.date")
            if form.draft.payerId == viewerId {
                Picker("Paid with", selection: $form.draft.accountId) {
                    Text("None").tag(String?.none)
                    ForEach(shell.workspace.load.ledger?.accounts ?? [], id: \.id) { account in
                        Text(account.name).tag(String?.some(account.id))
                    }
                }
                .accessibilityIdentifier("sharedForm.account")
            }
            if form.draft.original == nil || form.draft.isEditingRule {
                Picker("Repeat", selection: $form.draft.repeats) {
                    if form.draft.original == nil { Text("Never").tag(RecurrenceFrequency?.none) }
                    ForEach(RecurrenceFrequency.allCases, id: \.self) { frequency in
                        Text(SharedFormText.frequency(frequency)).tag(RecurrenceFrequency?.some(frequency))
                    }
                }
                .accessibilityIdentifier("sharedForm.repeat")
            }
            if form.draft.isEditingRule {
                Toggle("Active", isOn: $form.draft.active)
                    .accessibilityIdentifier("sharedForm.active")
            }
            TextField("Note", text: $form.draft.note, axis: .vertical)
                .focused($focus, equals: .note)
                .accessibilityIdentifier("sharedForm.note")
        } header: {
            Text("Details")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if form.draft.payerId == viewerId {
                    Text("Only you see which of your accounts paid. Other members never get it.")
                }
                if form.draft.isRule {
                    Text(
                        "A repeating expense is added on each date, split among the members active that day; when "
                            + "the members change, it's split equally.")
                }
                Text(HouseholdText.onlineRequirement)
            }
        }
    }
}

extension View {
    /// A money field: the decimal keypad on iPhone and iPad.
    func amountEntry() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }
}
