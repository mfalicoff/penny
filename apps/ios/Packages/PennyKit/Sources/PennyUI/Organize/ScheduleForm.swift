import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The schedule form (`edit-schedule` card), as a sheet: what the schedule records (kind, name,
/// amount and your share), its category and account, the next date and how often it repeats.
/// Editing changes future occurrences only; entries it already recorded keep their details. A
/// new schedule records its first date and repeats from there. A new account or category can
/// be created inline without losing this draft. A failed save keeps the draft and the reason.
struct ScheduleFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model: ScheduleFormModel
    @State private var addingAccount = false
    @State private var addingCategory = false

    init(rule: RecurringRule) {
        _model = State(initialValue: ScheduleFormModel(rule: rule))
    }

    init(today: CalendarDate, categories: [LedgerCategory]) {
        _model = State(initialValue: ScheduleFormModel(today: today, categories: categories))
    }

    var body: some View {
        let ledger = shell.workspace.load.ledger ?? Ledger(categories: [])
        NavigationStack {
            Form {
                if let failure = model.failure {
                    Section {
                        SaveErrorBanner(failure: failure, retry: { save(ledger) })
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                Section {
                    Picker(
                        "Kind",
                        selection: Binding(
                            get: { model.draft.kind }, set: { model.setKind($0, categories: ledger.categories) })
                    ) {
                        ForEach(EntryKind.allCases, id: \.self) { Text(OrganizeText.kind($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("scheduleForm.kind")
                }
                Section("Name") {
                    TextField("Rent, Payday, Streaming", text: $model.draft.title)
                        .accessibilityLabel("Name")
                        .accessibilityIdentifier("scheduleForm.title")
                }
                amountSection
                detailsSection(ledger)
                Section("Note") {
                    TextField("Optional", text: $model.draft.note, axis: .vertical)
                        .lineLimit(1...4)
                        .accessibilityLabel("Note")
                        .accessibilityIdentifier("scheduleForm.note")
                }
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .disabled(model.isSaving)
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("scheduleForm.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark") { save(ledger) }
                        .disabled(model.isSaving)
                        .accessibilityIdentifier("scheduleForm.save")
                }
            }
            .sheet(isPresented: $addingAccount) {
                AccountFormSheet { model.accountCreated($0) }.environment(shell)
            }
            .sheet(isPresented: $addingCategory) {
                CategoryFormSheet(kind: model.draft.kind) { model.categoryCreated($0) }.environment(shell)
            }
        }
        .tint(PennyColor.tint)
        .interactiveDismissDisabled(model.isSaving)
        .accessibilityIdentifier("screen.scheduleForm")
    }

    private var amountSection: some View {
        Section {
            TextField("0.00", text: $model.draft.amount)
                .scheduleMoneyEntry()
                .monospacedDigit()
                .accessibilityLabel("Amount")
                .accessibilityIdentifier("scheduleForm.amount")
            if model.draft.kind == .expense {
                Picker("Your share", selection: $model.draft.split) {
                    Text("All of it").tag(Money.SplitMode.full)
                    Text("Split equally").tag(Money.SplitMode.equal)
                    Text("An amount").tag(Money.SplitMode.amount)
                    Text("A percentage").tag(Money.SplitMode.percent)
                }
                .accessibilityIdentifier("scheduleForm.split")
                if model.draft.split != .full {
                    TextField(Self.sharePrompt(model.draft.split), text: $model.draft.shareInput)
                        .scheduleMoneyEntry()
                        .accessibilityLabel(Self.sharePrompt(model.draft.split))
                        .accessibilityIdentifier("scheduleForm.share")
                }
            }
        } header: {
            Text("Amount")
        } footer: {
            if model.draft.kind == .expense, model.draft.split != .full {
                Text("Reports count only your share.")
            }
        }
    }

    private func detailsSection(_ ledger: Ledger) -> some View {
        let categories = ledger.categories.filter { $0.kind == model.draft.kind }
        return Section {
            Picker("Category", selection: $model.draft.categoryId) {
                if !categories.contains(where: { $0.id == model.draft.categoryId }) {
                    Text("Choose").tag(model.draft.categoryId)
                }
                ForEach(categories, id: \.id) { Text($0.name).tag($0.id) }
            }
            .accessibilityIdentifier("scheduleForm.category")
            Button("New category…", systemImage: "plus") { addingCategory = true }
                .accessibilityIdentifier("scheduleForm.newCategory")
            Picker("Account", selection: $model.draft.accountId) {
                Text("None").tag(String?.none)
                if let id = model.draft.accountId, ledger.account(id: id) == nil {
                    Text("Removed account").tag(String?.some(id))
                }
                ForEach(ledger.accounts, id: \.id) { Text($0.name).tag(String?.some($0.id)) }
            }
            .accessibilityIdentifier("scheduleForm.account")
            Button("New account…", systemImage: "plus") { addingAccount = true }
                .accessibilityIdentifier("scheduleForm.newAccount")
            DatePicker(
                model.isNew ? "First date" : "Next date",
                selection: Binding(
                    get: { DayText.date(model.date ?? shell.today) },
                    set: { model.date = CalendarDate($0) }),
                in: DayText.date(.earliest)...DayText.date(.latest), displayedComponents: .date
            )
            .accessibilityIdentifier("scheduleForm.date")
            Picker(
                "Repeats",
                selection: Binding(
                    get: { model.draft.frequency ?? .monthly }, set: { model.draft.frequency = $0 })
            ) {
                ForEach(RecurrenceFrequency.allCases, id: \.self) { Text(ScheduleText.frequency($0)).tag($0) }
            }
            .accessibilityIdentifier("scheduleForm.frequency")
        } header: {
            Text("Schedule")
        } footer: {
            Text(
                model.isNew
                    ? "Penny records the first date now, then on each date as it comes. On the 29th to 31st, "
                        + "shorter months use their last day."
                    : "Changes apply to future occurrences. Recorded entries keep their original details.")
        }
    }

    static func sharePrompt(_ mode: Money.SplitMode) -> String {
        switch mode {
        case .equal: "Number of people"
        case .percent: "Your percentage"
        case .amount, .full: "Your share"
        }
    }

    private func save(_ ledger: Ledger) {
        Task {
            let saved = await model.save(
                categories: ledger.categories, with: { await shell.commit($0, summary: $1) })
            if saved != nil { dismiss() }
        }
    }
}

extension View {
    /// A money field: the decimal keypad on iOS.
    func scheduleMoneyEntry() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }
}
