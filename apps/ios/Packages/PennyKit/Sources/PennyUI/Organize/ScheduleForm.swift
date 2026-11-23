import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The schedule form (`schedule-form` card, MAZ-257), as a sheet: what the schedule records (kind,
/// then name, amount and your share in one group), its category (the category picker), account,
/// next date and how often it repeats, then a note.
/// Editing changes future occurrences only; entries it already recorded keep their details. A
/// new schedule records its first date and repeats from there. A new account or category can
/// be created inline without losing this draft. A failed save keeps the draft and the reason.
struct ScheduleFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model: ScheduleFormModel
    @State private var addingAccount = false
    @State private var pickingCategory = false

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
                amountSection
                detailsSection(ledger)
                CardSection("Note") {
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
                        .neutralToolbarGlyph()
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
            .sheet(isPresented: $pickingCategory) {
                EntryCategoryPickerSheet(
                    kind: model.draft.kind, selection: $model.draft.categoryId, ledger: ledger,
                    editCategories: { pickingCategory = false })
            }
            .pennySolidBars()
        }
        .tint(PennyColor.tint)
        .interactiveDismissDisabled(model.isSaving)
        .accessibilityIdentifier("screen.scheduleForm")
    }

    /// The card's first group: Name and Amount as labelled rows with the value on the right, then
    /// Your share for an expense.
    private var amountSection: some View {
        Section {
            LabeledContent("Name") {
                TextField("Rent, Payday, Streaming", text: $model.draft.title)
                    .multilineTextAlignment(.trailing)
                    .accessibilityLabel("Name")
                    .accessibilityIdentifier("scheduleForm.title")
            }
            LabeledContent("Amount") {
                TextField("0.00", text: $model.draft.amount)
                    .scheduleMoneyEntry()
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .accessibilityLabel("Amount")
                    .accessibilityIdentifier("scheduleForm.amount")
            }
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
        } footer: {
            if model.draft.kind == .expense { Text("Reports count only your share.") }
        }
    }

    private func detailsSection(_ ledger: Ledger) -> some View {
        let categories = ledger.categories.filter { $0.kind == model.draft.kind }
        let category = categories.first { $0.id == model.draft.categoryId }
        return Section {
            // The card's Category row: the category's tile and name, opening the category picker
            // (Most used, every category and New, so the draft stays).
            Button {
                pickingCategory = true
            } label: {
                HStack(spacing: 8) {
                    Text("Category").foregroundStyle(PennyColor.label)
                    Spacer()
                    if let category {
                        Image(systemName: EntryText.tileSymbol(model.draft.kind, category: category))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(
                                EntryText.tileColor(model.draft.kind, category: category, id: category.id),
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                            )
                            .accessibilityHidden(true)
                    }
                    Text(category?.name ?? "Choose").foregroundStyle(PennyColor.secondaryLabel)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tertiaryLabel)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Category, \(category?.name ?? "none")")
            .accessibilityIdentifier("scheduleForm.category")
            // The card's Account menu; New account… is its last item, so the draft stays.
            Picker("Account", selection: accountChoice) {
                Text("None").tag(AccountChoice.account(nil))
                if let id = model.draft.accountId, ledger.account(id: id) == nil {
                    Text("Removed account").tag(AccountChoice.account(id))
                }
                ForEach(ledger.accounts, id: \.id) { Text($0.name).tag(AccountChoice.account($0.id)) }
                Divider()
                Label("New account…", systemImage: "plus").tag(AccountChoice.new)
            }
            .accessibilityIdentifier("scheduleForm.account")
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
            Text("Schedule").cardSectionHeader()
        } footer: {
            Text(
                model.isNew
                    ? "Penny records the first date now, then on each date as it comes. On the 29th to 31st, "
                        + "shorter months use their last day."
                    : "Changes apply to future occurrences. Recorded entries keep their original details.")
        }
    }

    private enum AccountChoice: Hashable {
        case account(String?)
        case new
    }

    private var accountChoice: Binding<AccountChoice> {
        Binding(
            get: { .account(model.draft.accountId) },
            set: { choice in
                switch choice {
                case .account(let id): model.draft.accountId = id
                case .new: addingAccount = true
                }
            })
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
