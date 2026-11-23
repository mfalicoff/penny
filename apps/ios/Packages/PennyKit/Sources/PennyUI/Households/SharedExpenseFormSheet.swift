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
/// `shared-expense`, `shared-split` and `shared-payer`). It is laid out like Add entry: a large
/// amount with the keypad on iPhone, a name, Paid by as chips and the split with each share (as
/// the card, so the split shows above the keypad), your share, the most used categories, then
/// labeled rows for Household, Date and Account, with repeat and note behind one disclosure row
/// and Save as the toolbar check. Opened from Add entry (`scope`), it also has
/// the Household row, so it can go back to being a personal entry with what was typed.
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
    /// What was typed in the personal form before this household was chosen.
    var handoff: EntryHandoff?
    /// Add entry's type and Household choice (new expenses only).
    var scope: EntryScope?

    @State private var form: SharedExpenseFormModel?
    @State private var restored = false

    var body: some View {
        Group {
            if let form {
                SharedExpenseForm(form: form, model: model, scope: scope, restored: $restored, close: close)
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
        let ledger = shell.workspace.load.ledger
        var fresh: SharedExpenseDraft
        switch request {
        case .new:
            let categories = ledger?.categoriesByUse(.expense) ?? []
            fresh = SharedExpenseDraft(
                householdId: model.id, payerId: viewerId ?? "", today: Self.defaultDate(model.month, shell.today),
                category: categories.first.map(WireSharedCategory.init) ?? .other)
            if let handoff {
                // Carried over from the personal form: that wins over an older kept draft.
                handoff.apply(to: &fresh, ledger: ledger)
                return (fresh, false)
            }
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

/// Pages pushed inside the shared expense sheet.
private enum SharedFormPage: Hashable {
    case account
    case details
}

/// Sheets stacked over the shared expense form.
private enum SharedFormOverlay: String, Identifiable {
    case date, split, category, household
    var id: String { rawValue }
}

private struct SharedExpenseForm: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Bindable var form: SharedExpenseFormModel
    let model: HouseholdModel
    let scope: EntryScope?
    @Binding var restored: Bool
    let close: () -> Void

    @FocusState private var focus: SharedExpenseDraft.Field?
    @State private var confirmingClose = false
    @State private var saved = false
    @State private var discarded = false
    @State private var overlay: SharedFormOverlay?
    /// The Household sheet's choice, applied once the sheet has gone (`nil` inside: Personal).
    @State private var pendingHousehold: String??
    @State private var amountActive = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    banners
                    amount
                    // `iphone-shared-expense-add`: the category is a pill in the name field.
                    HStack(spacing: 8) {
                        TextField("What was it for?", text: $form.draft.title)
                            .nameEntry()
                            .focused($focus, equals: .title)
                            .submitLabel(.done)
                            .font(.body)
                            .accessibilityLabel("Name")
                            .accessibilityIdentifier("sharedForm.title")
                        categoryPill
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .background(
                        PennyColor.secondarySurface,
                        in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                    )
                    Group {
                        payerAndSplit
                        yourShare
                        rows
                        notes
                    }
                    // Choosing anything below the name puts the keypad away, so the shares show.
                    .simultaneousGesture(TapGesture().onEnded { amountActive = false })
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(PennyColor.surface)
            .safeAreaInset(edge: .bottom) {
                if showsKeypad {
                    AmountKeypad { key in form.draft.amountText = AmountInput.apply(key, to: form.draft.amountText) }
                }
            }
            .navigationTitle(title)
            // The household under the title, so the form says where the expense goes.
            .navigationSubtitle(model.household?.name ?? "")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        if form.hasChanges { confirmingClose = true } else { close() }
                    }
                    .neutralToolbarGlyph()
                    .disabled(form.isSaving)
                    .accessibilityIdentifier("sharedForm.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if form.isSaving { ProgressView() } else { Label("Save", systemImage: "checkmark") }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PennyColor.tint)
                    .disabled(form.isSaving || form.isStale)
                    .accessibilityLabel(form.isSaving ? "Saving" : "Save")
                    .accessibilityIdentifier("sharedForm.save")
                }
            }
            .navigationDestination(for: SharedFormPage.self) { page in
                switch page {
                case .account:
                    if let ledger {
                        EntryAccountPicker(selection: $form.draft.accountId, ledger: ledger)
                    }
                case .details:
                    SharedDetailsPage(form: form)
                }
            }
            .sheet(item: $overlay, onDismiss: applyHousehold) { overlay in
                switch overlay {
                case .date:
                    EntryDatePickerSheet(date: dateText, today: shell.today)
                case .split:
                    SharedSplitSheet(form: form, model: model)
                case .category:
                    if let ledger {
                        EntryCategoryPickerSheet(
                            kind: .expense, selection: categoryId(in: ledger), ledger: ledger,
                            editCategories: { self.overlay = nil })
                    }
                case .household:
                    EntryHouseholdSheet(
                        households: scope?.households ?? [], current: model.id,
                        initials: shell.account.map { HouseholdPeople.initials(email: $0.email) } ?? ""
                    ) { id in
                        pendingHousehold = .some(id)
                    }
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
            .pennySolidBars()
        }
        .interactiveDismissDisabled(form.hasChanges || form.isSaving)
        .sensoryFeedback(.error, trigger: form.refusedCount)
        .onAppear {
            // Editing opens on the whole form; a new expense opens on the amount.
            if form.draft.original != nil { amountActive = false }
            // iPad types the amount in a field; iPhone uses the keypad, so nothing needs focus.
            if sizeClass == .regular, restored || form.draft.original == nil {
                focus = restored ? (form.draft.focus ?? .amount) : .amount
            }
        }
        .onChange(of: focus) { if let focus { form.draft.focus = focus } }
        .onDisappear {
            // Replaced by a link, switched to another household or closed some other way: keep
            // what was typed for this session.
            if !saved, form.saved == nil, !discarded, form.hasChanges { form.keepDraft() }
        }
        .accessibilityIdentifier("screen.sharedExpenseForm")
    }

    private var isNew: Bool { form.draft.original == nil }

    private var title: String {
        switch form.draft.original {
        case .expense: "Edit expense"
        case .rule: "Edit repeating expense"
        case nil: form.draft.repeats == nil ? "New expense" : "New repeating expense"
        }
    }

    private var ledger: Ledger? { shell.workspace.load.ledger }
    private var participants: [WireHouseholdMember] { form.participants }
    private var locked: Bool { form.draft.isPaidExpense }
    private var viewerId: String? { form.viewerId }
    /// The keypad shows while the amount is being typed: a new expense starts there, tapping the
    /// amount brings it back, and the name or any other choice puts it away (MAZ-256: it no longer
    /// covers the shares).
    private var showsKeypad: Bool { sizeClass != .regular && amountActive && focus != .title && !locked }

    private func save() async {
        focus = nil
        if await form.save() != nil {
            saved = true
            restored = false
            close()
        }
    }

    // MARK: Parts

    @ViewBuilder private var banners: some View {
        if restored {
            StatusBanner(tone: .info, title: "Your unsaved expense is back") {
                InlineActionButton("Discard") {
                    form.discardDraft()
                    discarded = true
                    restored = false
                    close()
                }
                .accessibilityIdentifier("sharedForm.discard")
            }
            .accessibilityIdentifier("sharedForm.restoredDraft")
        }
        if let reason = model.readOnlyReason {
            StatusBanner(tone: .info, title: "You can't add to this household", message: reason)
        }
        if let failure = form.failure {
            StatusBanner(
                tone: failure.kind == .offline ? .offline : .error,
                title: form.isStale ? "Changed by someone else" : HouseholdFailureBanner.title(failure.kind),
                message: form.isStale
                    ? (form.latest == nil
                        ? "It was deleted after you opened it. Nothing was saved."
                        : "Someone changed it after you opened it. Nothing was saved; review the latest version.")
                    : failure.message + (failure.canRetry ? " Your changes are kept." : "")
            ) {
                if form.isStale, form.latest != nil {
                    InlineActionButton("Review latest") {
                        _ = form.reviewLatest()
                        restored = false
                    }
                    .accessibilityIdentifier("sharedForm.reviewLatest")
                } else if failure.canRetry {
                    InlineActionButton("Try again") { Task { await save() } }
                }
            }
            .accessibilityIdentifier("sharedForm.error")
        }
        if let problem = form.problem {
            Label(problem.message(money: HouseholdText.money(model.currency)), systemImage: "exclamationmark.circle")
                .foregroundStyle(PennyColor.danger)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("sharedForm.problem")
        }
        if locked {
            Text(
                "Someone has repaid a share, so the total, payer, month and shares stay as they are. The name, "
                    + "category, note and day can still change."
            )
            .font(.footnote)
            .foregroundStyle(PennyColor.secondaryLabel)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var amount: some View {
        VStack(spacing: 6) {
            if sizeClass == .regular {
                TextField("0.00", text: $form.draft.amountText)
                    .amountEntry()
                    .multilineTextAlignment(.center)
                    .modifier(HeroAmountFont())
                    .focused($focus, equals: .amount)
                    .disabled(locked)
                    .accessibilityLabel("Total amount, \(model.currency)")
                    .accessibilityIdentifier("sharedForm.amount")
            } else {
                Button {
                    focus = nil
                    amountActive = true
                } label: {
                    AmountDisplay(text: form.draft.amountText, kind: .expense, currency: model.currency)
                }
                .buttonStyle(.plain)
                .disabled(locked)
                .accessibilityLabel("Total amount, \(model.currency)")
                .accessibilityValue(form.draft.amountText.isEmpty ? "Empty" : form.draft.amountText)
                .accessibilityHint("Use the keypad below to type the amount.")
                .accessibilityIdentifier("sharedForm.amount")
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The category as a pill in the name field (`iphone-shared-expense-add`); it opens the
    /// category picker. The expense keeps a category the ledger no longer has until another is chosen.
    private var categoryPill: some View {
        Button {
            focus = nil
            amountActive = false
            overlay = .category
        } label: {
            Label(form.draft.category.name, systemImage: form.draft.category.symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.label)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(PennyColor.fill, in: Capsule())
                .fixedSize()
        }
        .buttonStyle(.plain)
        .disabled(ledger == nil)
        .accessibilityLabel("Category, \(form.draft.category.name)")
        .accessibilityHint("Opens the categories")
        .accessibilityIdentifier("sharedForm.category")
    }

    /// Chips and the picker work with ledger ids; the shared expense keeps the category by value.
    private func categoryId(in ledger: Ledger) -> Binding<String> {
        Binding(
            get: {
                ledger.categories.first { $0.kind == .expense && $0.name == form.draft.category.name }?.id ?? ""
            },
            set: { id in
                if let category = ledger.category(id: id) { form.draft.category = WireSharedCategory(category) }
            })
    }

    private var dateText: Binding<String> {
        Binding(
            get: { form.draft.date.description },
            set: { text in if let date = CalendarDate.ledgerDate(text) { form.draft.date = date } })
    }

    @ViewBuilder private var rows: some View {
        VStack(spacing: 0) {
            if let scope, isNew {
                Button {
                    overlay = .household
                } label: {
                    EntryFieldRow("Household", systemImage: "house", value: scope.name(of: model.id))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sharedForm.household")
                divider
            }
            Button {
                overlay = .date
            } label: {
                EntryFieldRow(
                    form.draft.isRule ? "Next date" : "Date", systemImage: "calendar",
                    value: EntryText.day(form.draft.date, today: shell.today))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("sharedForm.date")
            if form.draft.payerId == viewerId, let ledger {
                divider
                NavigationLink(value: SharedFormPage.account) {
                    EntryFieldRow(
                        "Account", systemImage: "creditcard",
                        value: form.draft.accountId.flatMap(ledger.account(id:))?.name ?? "None", chevron: true)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sharedForm.account")
            }
            divider
            NavigationLink(value: SharedFormPage.details) {
                EntryFieldRow(
                    isNew || form.draft.isEditingRule ? "Repeat, note" : "Note", systemImage: "ellipsis",
                    value: detailsValue, chevron: true)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("sharedForm.details")
        }
        .background(
            PennyColor.secondarySurface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }

    /// Paid by and Split in the form, as on the card, so the split shows above the keypad: the
    /// members on the expense's date as chips, then the split mode and each member's share.
    /// Amounts and percentages are typed in the Split sheet (Edit shares).
    @ViewBuilder private var payerAndSplit: some View {
        let preview = form.draft.preview(participants: participants)
        VStack(alignment: .leading, spacing: 10) {
            Text("Paid by").cardSectionHeader()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(participants) { member in
                        payerChip(member)
                    }
                }
            }
            .scrollClipDisabled()
            .accessibilityIdentifier("sharedForm.paidBy")
            if participants.isEmpty {
                Text("Nobody was a member on that date. Choose another date.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            Text("Split").cardSectionHeader()
                .padding(.top, 4)
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
            VStack(spacing: 0) {
                ForEach(participants) { member in
                    let share = (try? preview.get())?.first { $0.userId == member.userId }?.amountCents
                    HStack(spacing: 10) {
                        Monogram(initials: model.people.initials(member.userId))
                        Text(model.people.name(member.userId)).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(share.map { MoneyFormat.amount($0, currency: model.currency) } ?? "—")
                            .monospacedDigit()
                            .fontWeight(member.userId == viewerId ? .semibold : .regular)
                            .foregroundStyle(member.userId == viewerId ? PennyColor.label : PennyColor.secondaryLabel)
                    }
                    .font(.callout)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("sharedForm.split.\(member.userId)")
                    if member.userId != participants.last?.userId || form.draft.mode != .equal { shareDivider }
                }
                if form.draft.mode != .equal {
                    Button {
                        overlay = .split
                    } label: {
                        EntryFieldRow("Edit shares", systemImage: "slider.horizontal.3", value: splitValue)
                    }
                    .buttonStyle(.plain)
                    .disabled(locked)
                    .accessibilityIdentifier("sharedForm.splitRow")
                }
            }
            .background(
                PennyColor.secondarySurface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
    }

    private func payerChip(_ member: WireHouseholdMember) -> some View {
        let chosen = form.draft.payerId == member.userId
        return Button {
            form.draft.choosePayer(member.userId, viewerId: viewerId)
        } label: {
            HStack(spacing: 6) {
                Monogram(initials: model.people.initials(member.userId))
                Text(member.userId == viewerId ? "You" : model.people.name(member.userId)).lineLimit(1)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.leading, 4)
            .padding(.trailing, 12)
            .frame(minHeight: Metrics.minTouchTarget)
            // The card's `.pill.on`: the label color, inverted, not copper.
            .foregroundStyle(chosen ? PennyColor.surface : PennyColor.label)
            .background(chosen ? PennyColor.label : PennyColor.secondarySurface, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(locked)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityLabel("Paid by \(model.people.name(member.userId))")
        .accessibilityIdentifier("sharedForm.payer.\(member.userId)")
    }

    private var divider: some View { EntryFieldRow.divider }
    /// Between the split rows: inset past the monogram, as on the card.
    private var shareDivider: some View { Divider().padding(.leading, 58) }

    private var splitValue: String {
        let people = participants.count
        guard people > 0 else { return "Nobody on that date" }
        switch form.draft.mode {
        case .equal: return "Equally · \(people) \(people == 1 ? "person" : "people")"
        case .exact: return "By amount"
        case .percent: return "By percent"
        }
    }

    private var detailsValue: String {
        var parts: [String] = []
        if let repeats = form.draft.repeats { parts.append(SharedFormText.frequency(repeats)) }
        if form.draft.isEditingRule, !form.draft.active { parts.append("Paused") }
        if !form.draft.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parts.append("Note") }
        return parts.joined(separator: " · ")
    }

    /// `iphone-shared-expense-add`: "Your share · in your spending" on the fill, the amount bold
    /// and unsigned, as the card draws it.
    private var yourShare: some View {
        HStack {
            Text("Your share \(Text("· in your spending").foregroundStyle(PennyColor.secondaryLabel))")
                .font(.subheadline)
            Spacer()
            if let share = form.viewerShare {
                Text(MoneyFormat.amount(share, currency: model.currency))
                    .font(.title3.weight(.bold)).monospacedDigit()
            } else {
                Text("—").foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sharedForm.yourShare")
    }

    private var notes: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(
                "Everyone in \(model.household?.name ?? "the household") sees the full amount. Only your share "
                    + "counts in your spending.")
            if form.draft.payerId == viewerId {
                Text("Only you see which of your accounts paid. Other members never get it.")
            }
            Text(HouseholdText.onlineRequirement)
        }
        .font(.footnote)
        .foregroundStyle(PennyColor.secondaryLabel)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// After the Household sheet: Personal or another household takes what was typed.
    private func applyHousehold() {
        guard let choice = pendingHousehold else { return }
        pendingHousehold = nil
        guard let scope, choice != model.id else { return }
        discarded = true
        form.discardDraft()
        scope.choose(choice, EntryHandoff(form.draft, viewerId: viewerId))
    }
}

/// Split: equally, by amount or by percent, with each member's share and yours.
private struct SharedSplitSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var form: SharedExpenseFormModel
    let model: HouseholdModel

    private var participants: [WireHouseholdMember] { form.participants }
    private var locked: Bool { form.draft.isPaidExpense }

    var body: some View {
        let preview = form.draft.preview(participants: participants)
        NavigationStack {
            Form {
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
                        Text("Your share · counts in your spending").font(.subheadline.weight(.semibold))
                        Spacer()
                        if let share = form.viewerShare {
                            MoneyText(share, meaning: .expense, currency: model.currency)
                        } else {
                            Text("—").foregroundStyle(PennyColor.secondaryLabel)
                        }
                    }
                    .accessibilityElement(children: .combine)
                } footer: {
                    if case .failure(let problem) = preview, form.draft.totalCents != nil {
                        Text(problem.message(money: HouseholdText.money(model.currency)))
                    } else {
                        Text(
                            "Only your share counts in your spending. Splits include the members on the expense's "
                                + "date; the server rounds leftover cents the same way.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .navigationTitle("Split")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            .pennySolidBars()
        }
        .presentationDetents([.large])
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
                    .disabled(locked)
                    .accessibilityLabel("\(model.people.name(member.userId))'s share")
            case .percent:
                TextField("0", text: binding(\.percentTexts, member.userId))
                    .amountEntry()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80)
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
}

/// Repeat, Active (a repeating expense) and Note, behind the form's last row as in Add entry.
private struct SharedDetailsPage: View {
    @Bindable var form: SharedExpenseFormModel
    @FocusState private var noteFocused: Bool

    var body: some View {
        Form {
            if form.draft.original == nil || form.draft.isEditingRule {
                Section {
                    Picker("Repeat", selection: $form.draft.repeats) {
                        if form.draft.original == nil { Text("Never").tag(RecurrenceFrequency?.none) }
                        ForEach(RecurrenceFrequency.allCases, id: \.self) { frequency in
                            Text(SharedFormText.frequency(frequency)).tag(RecurrenceFrequency?.some(frequency))
                        }
                    }
                    .accessibilityIdentifier("sharedForm.repeat")
                    if form.draft.isEditingRule {
                        Toggle("Active", isOn: $form.draft.active)
                            .accessibilityIdentifier("sharedForm.active")
                    }
                } footer: {
                    if form.draft.isRule {
                        Text(
                            "A repeating expense is added on each date, split among the members active that day; "
                                + "when the members change, it's split equally.")
                    }
                }
            }
            Section {
                TextField("Note", text: $form.draft.note, axis: .vertical)
                    .focused($noteFocused)
                    .accessibilityIdentifier("sharedForm.note")
            }
        }
        .scrollContentBackground(.hidden)
        .background(PennyColor.background)
        .navigationTitle(form.draft.original == nil || form.draft.isEditingRule ? "Repeat, note" : "Note")
        .toolbarTitleDisplayModeInline()
        .onChange(of: noteFocused) { if noteFocused { form.draft.focus = .note } }
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
