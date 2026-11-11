import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `category-picker`: every category of the entry's kind, most used first, with search, a
/// New tile (inline creation, the draft stays) and Edit categories (Settings).
struct EntryCategoryPickerSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let kind: EntryKind
    @Binding var selection: String
    let ledger: Ledger
    let editCategories: () -> Void
    @State private var query = ""
    @State private var creating = false

    private let columns = [GridItem(.adaptive(minimum: 76), spacing: 12)]

    var body: some View {
        let all = ledger.categoriesByUse(kind)
        let needle = SearchText.normalize(query)
        let matches = needle.isEmpty ? all : all.filter { SearchText.normalize($0.name).contains(needle) }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if needle.isEmpty, all.count > 4 {
                        section("Most used", Array(all.prefix(4)), showNew: false)
                    }
                    section(needle.isEmpty ? "All categories" : "Matching", matches, showNew: true)
                    Button("Edit categories", action: editCategories)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(PennyColor.tintText)
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                        .accessibilityIdentifier("categoryPicker.edit")
                }
                .padding(Metrics.gutter)
            }
            .background(PennyColor.background)
            .searchable(text: $query, prompt: "Search categories")
            .navigationTitle(Self.title(kind))
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("categoryPicker.close")
                }
            }
            .sheet(isPresented: $creating) {
                CategoryFormSheet(kind: kind, name: query) { category in
                    selection = category.id
                    dismiss()
                }
                .environment(shell)
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("screen.categoryPicker")
    }

    static func title(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "Expense category"
        case .income: "Income category"
        case .investment: "Investment category"
        }
    }

    private func section(_ title: String, _ categories: [LedgerCategory], showNew: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(categories, id: \.id) { category in tile(category) }
                if showNew {
                    Button {
                        creating = true
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "plus")
                                .font(.title2)
                                .foregroundStyle(PennyColor.secondaryLabel)
                                .frame(width: 56, height: 56)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                                        .foregroundStyle(PennyColor.separator))
                            Text("New").font(.footnote).foregroundStyle(PennyColor.label)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("New category")
                    .accessibilityIdentifier("categoryPicker.new")
                }
            }
            .padding(14)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
    }

    private func tile(_ category: LedgerCategory) -> some View {
        let selected = category.id == selection
        return Button {
            selection = category.id
            dismiss()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: EntryText.symbol(category))
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(
                        EntryText.color(category, id: category.id),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 19, style: .continuous)
                            .stroke(selected ? PennyColor.tint : .clear, lineWidth: 3)
                            .padding(-3))
                Text(category.name)
                    .font(.footnote.weight(selected ? .semibold : .regular))
                    .foregroundStyle(PennyColor.label)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(category.name)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("categoryPicker.\(category.id)")
    }
}

/// `account-picker`: None or one of the ledger's payment accounts (labels, never balances),
/// and New account (inline creation; the draft stays).
struct EntryAccountPicker: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: String?
    let ledger: Ledger
    @State private var creating = false

    var body: some View {
        List {
            Section {
                row(nil, title: "None", symbol: "minus.circle")
                ForEach(ledger.accounts, id: \.id) { account in
                    row(account.id, title: account.name, symbol: Self.symbol(account.type))
                }
            } footer: {
                Text("Accounts are labels for which card or account paid. Penny doesn't track balances.")
            }
            Section {
                Button {
                    creating = true
                } label: {
                    Label("New account", systemImage: "plus")
                }
                .accessibilityIdentifier("accountPicker.new")
            }
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle("Account")
        .toolbarTitleDisplayModeInline()
        .sheet(isPresented: $creating) {
            AccountFormSheet { account in
                selection = account.id
                dismiss()
            }
            .environment(shell)
        }
        .accessibilityIdentifier("screen.accountPicker")
    }

    private func row(_ id: String?, title: String, symbol: String) -> some View {
        let key = id ?? "none"
        return Button {
            selection = id
            dismiss()
        } label: {
            HStack {
                Label(title, systemImage: symbol).foregroundStyle(PennyColor.label)
                Spacer()
                if selection == id {
                    Image(systemName: "checkmark").foregroundStyle(PennyColor.tint).accessibilityHidden(true)
                }
            }
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selection == id ? .isSelected : [])
        .accessibilityIdentifier("accountPicker.\(key)")
    }

    static func symbol(_ type: AccountType) -> String {
        switch type {
        case .bank: "building.columns"
        case .credit: "creditcard"
        case .cash: "banknote"
        case .other: "wallet.bifold"
        }
    }
}

/// `date-picker`: a calendar limited to the ledger's dates (2000–2100), with Today and
/// Yesterday shortcuts.
struct EntryDatePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var date: String
    let today: CalendarDate

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                DatePicker("Date", selection: selection, in: Self.range, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(PennyColor.tint)
                    .accessibilityIdentifier("datePicker.calendar")
                HStack {
                    Button("Today") { pick(today) }
                        .accessibilityIdentifier("datePicker.today")
                    Button("Yesterday") { pick(today.adding(days: -1)) }
                        .accessibilityIdentifier("datePicker.yesterday")
                }
                .buttonStyle(.bordered)
                Spacer(minLength: 0)
            }
            .padding(Metrics.gutter)
            .background(PennyColor.background)
            .navigationTitle("Date")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                        .accessibilityIdentifier("datePicker.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("screen.datePicker")
    }

    private var selection: Binding<Date> {
        Binding(
            get: { DayText.date(CalendarDate.ledgerDate(date) ?? today) },
            set: { date = CalendarDate($0).description })
    }

    private func pick(_ day: CalendarDate) {
        date = day.description
        dismiss()
    }

    static let range: ClosedRange<Date> = DayText.date(.earliest)...DayText.date(.latest)
}

/// `split`: a personal split. Only your share counts toward spending; the total stays on the
/// entry. A personal split stores no names: equally is a head count including you.
struct EntrySplitSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var draft: EntryDraft
    let currency: String
    @State private var mode: Money.SplitMode = .full
    @State private var people = 2
    @State private var input = ""

    var body: some View {
        let total = try? Money.cents(draft.amount)
        let result = Result<Int64, LedgerRuleError>(catching: { () throws(LedgerRuleError) -> Int64 in
            try Money.personalShare(total: total ?? 0, mode: mode, input: shareInput)
        })
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Picker("Split", selection: $mode) {
                        Text("All mine").tag(Money.SplitMode.full)
                        Text("Equally").tag(Money.SplitMode.equal)
                        Text("Amount").tag(Money.SplitMode.amount)
                        Text("Percent").tag(Money.SplitMode.percent)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("split.mode")
                    switch mode {
                    case .full: EmptyView()
                    case .equal:
                        Stepper(value: $people, in: 2...100) {
                            HStack {
                                Text("People, including you")
                                Spacer()
                                Text("\(people)").font(.title3.weight(.bold)).monospacedDigit()
                            }
                        }
                        .padding(16)
                        .background(
                            PennyColor.surface,
                            in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                        )
                        .accessibilityIdentifier("split.people")
                    case .amount, .percent:
                        HStack {
                            Text(mode == .amount ? "Your share" : "Your percentage")
                            Spacer()
                            TextField(mode == .amount ? "0.00" : "50", text: $input)
                                .decimalEntry()
                                .multilineTextAlignment(.trailing)
                                .font(.title3.weight(.semibold).monospacedDigit())
                                .accessibilityIdentifier("split.input")
                            if mode == .percent { Text("%") }
                        }
                        .padding(16)
                        .background(
                            PennyColor.surface,
                            in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                        )
                    }
                    shareCard(total: total, result: result)
                }
                .padding(Metrics.gutter)
            }
            .background(PennyColor.background)
            .navigationTitle("Split")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("split.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { apply() }
                        .disabled(total == nil || (try? result.get()) == nil)
                        .accessibilityIdentifier("split.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear(perform: load)
        .accessibilityIdentifier("screen.split")
    }

    private var shareInput: String {
        switch mode {
        case .full: ""
        case .equal: String(people)
        case .amount, .percent: input
        }
    }

    @ViewBuilder
    private func shareCard(total: Int64?, result: Result<Int64, LedgerRuleError>) -> some View {
        VStack(spacing: 8) {
            Text("YOUR SHARE").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
            switch (total, result) {
            case (nil, _):
                Text("Enter the amount first.").foregroundStyle(PennyColor.secondaryLabel)
            case (let total?, .success(let share)):
                Text(MoneyFormat.amount(share, currency: currency))
                    .font(.largeTitle.weight(.bold).monospacedDigit())
                    .accessibilityIdentifier("split.share")
                Text(
                    "Only your share counts toward your spending. The \(MoneyFormat.amount(total, currency: currency)) total stays on the entry."
                )
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
            case (_, .failure(let error)):
                Text(error.message)
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.danger)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("split.error")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func load() {
        mode = draft.split
        switch draft.split {
        case .equal: people = Int(draft.shareInput) ?? 2
        case .amount, .percent: input = draft.shareInput
        case .full: break
        }
    }

    private func apply() {
        draft.split = mode
        draft.shareInput = shareInput
        dismiss()
    }
}

/// `entry-extras` (More details), with the `repeat-picker` and `trip-picker`: receipt,
/// repeat, trip and note. Repeat is offered for a new entry only (an edit changes this entry,
/// not its schedule); trips and receipts belong to expenses only.
struct EntryExtrasView: View {
    @Environment(ShellModel.self) private var shell
    @Bindable var model: EntryFormModel
    let ledger: Ledger
    let save: () -> Void
    @State private var receiptFailure: String?
    @State private var attaching = false

    var body: some View {
        let draft = model.draft
        Form {
            if draft.kind == .expense { receipt(draft) }
            Section {
                if model.editor.isNew {
                    Picker("Repeat", selection: $model.editor.draft.frequency) {
                        Text("Never").tag(RecurrenceFrequency?.none)
                        Text("Weekly").tag(RecurrenceFrequency?.some(.weekly))
                        Text("Monthly").tag(RecurrenceFrequency?.some(.monthly))
                        Text("Yearly").tag(RecurrenceFrequency?.some(.yearly))
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("entryExtras.repeat")
                } else {
                    Text(model.editor.original?.recurringId == nil ? "Doesn't repeat" : "Recorded from a schedule")
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
            } header: {
                Text("Repeat")
            } footer: {
                Text(
                    model.editor.isNew
                        ? "Repeating creates a schedule you can pause in Recurring."
                        : "Editing changes this entry only. Change future dates in Recurring.")
            }
            if draft.kind == .expense {
                Section("Trip") {
                    tripRow(nil, name: "No trip")
                    ForEach(ledger.trips.sorted { $0.startDate > $1.startDate }, id: \.id) { trip in
                        tripRow(trip.id, name: trip.name)
                    }
                }
            }
            Section("Note") {
                TextField("Anything you'd like to remember", text: $model.editor.draft.note, axis: .vertical)
                    .lineLimit(3...8)
                    .accessibilityIdentifier("entryExtras.note")
            }
        }
        .scrollContentBackground(.hidden)
        .background(PennyColor.background)
        .navigationTitle("More details")
        .toolbarTitleDisplayModeInline()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                EntrySaveButton(saving: model.editor.isSaving, action: save)
            }
        }
        .alert(
            "Couldn't attach the receipt",
            isPresented: Binding(get: { receiptFailure != nil }, set: { if !$0 { receiptFailure = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(receiptFailure ?? "")
        }
        .accessibilityIdentifier("screen.entryExtras")
    }

    @ViewBuilder
    private func receipt(_ draft: EntryDraft) -> some View {
        Section {
            if let receipt = draft.receipt {
                HStack {
                    Label(receipt.name, systemImage: receipt.mime == "application/pdf" ? "doc" : "photo")
                    Spacer()
                    Button("Remove receipt", systemImage: "xmark.circle.fill") { model.editor.draft.receipt = nil }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityIdentifier("entryExtras.removeReceipt")
                }
            }
            if let attach = shell.attachReceipt {
                HStack {
                    Button("Photo", systemImage: "photo") { run(attach, .photo) }
                        .accessibilityIdentifier("entryExtras.receiptPhoto")
                    Spacer()
                    Button("File or PDF", systemImage: "doc") { run(attach, .file) }
                        .accessibilityIdentifier("entryExtras.receiptFile")
                }
                .buttonStyle(.borderless)
                .disabled(attaching)
            }
        } header: {
            Text("Receipt")
        } footer: {
            if shell.attachReceipt == nil {
                Text(
                    draft.receipt == nil
                        ? "Adding receipts isn't available in this version of Penny yet."
                        : "Removing the receipt detaches it from this entry when you save.")
            }
        }
    }

    private func run(
        _ attach: @escaping (ReceiptSource) async -> Result<ReceiptReference, SaveFailure>, _ source: ReceiptSource
    ) {
        attaching = true
        Task {
            switch await attach(source) {
            case .success(let receipt): model.editor.draft.receipt = receipt
            case .failure(let failure): receiptFailure = failure.message
            }
            attaching = false
        }
    }

    private func tripRow(_ id: String?, name: String) -> some View {
        let selected = model.draft.tripId == id
        let key = id ?? "none"
        return Button {
            model.editor.draft.tripId = id
        } label: {
            HStack {
                Label(name, systemImage: id == nil ? "xmark" : "airplane").foregroundStyle(PennyColor.label)
                Spacer()
                if selected {
                    Image(systemName: "checkmark").foregroundStyle(PennyColor.tint).accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("entryExtras.trip.\(key)")
    }
}
