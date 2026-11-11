import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Add and edit entry (`add-expense`, `add-income`, `add-investment`, `edit-entry` cards;
/// `/entries/new` and the widget +). A sheet with the type, a large amount with an
/// always-visible keypad on iPhone (the keyboard on iPad), a name, the most used categories as
/// chips, and labeled Date, Account and Split rows; receipt, repeat, trip and note sit behind
/// one disclosure row. Save is the toolbar check, so the keyboard never covers it.
///
/// The draft lives in an `EntryFormModel` for the whole sheet: nested pickers, inline account
/// and category creation and failed saves never lose it. Closing with changes asks first; a
/// sheet replaced by something else (a deep link, Settings) keeps the draft on the shell's
/// shelf and restores it next time.
struct EntryFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let mode: EntryEditor.Mode

    var body: some View {
        NavigationStack {
            WorkspaceContent { ledger in
                EntryForm(mode: mode, ledger: ledger)
            }
            .toolbar {
                if shell.workspace.load.ledger == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.large])
        .accessibilityIdentifier(mode == .new ? "screen.addEntry" : "screen.editEntry")
    }
}

/// Pages pushed inside the entry sheet.
enum EntryFormPage: Hashable {
    case account
    case details
}

/// Sheets stacked over the entry form.
enum EntryFormOverlay: String, Identifiable {
    case date, split, category
    var id: String { rawValue }
}

private struct EntryForm: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    let mode: EntryEditor.Mode
    let ledger: Ledger

    @State private var model: EntryFormModel?
    @State private var restored = false
    /// Set when the form closes on purpose (saved or discarded), so nothing is kept.
    @State private var closing = false
    @State private var confirmClose = false
    @State private var overlay: EntryFormOverlay?
    @State private var entryGone = false
    @FocusState private var titleFocused: Bool

    var body: some View {
        Group {
            if let model {
                form(model)
            } else {
                Color.clear
            }
        }
        .onAppear { if model == nil { start() } }
    }

    private func start() {
        let editor: EntryEditor
        if let kept = shell.drafts.take(mode) {
            editor = kept
            restored = true
        } else {
            editor = Self.fresh(mode, today: shell.today, ledger: ledger)
        }
        let shell = self.shell
        let mode = self.mode
        model = EntryFormModel(editor: editor) { change, summary in
            let failure = await shell.commit(change, summary: summary)
            // The shelf holds the draft while the save runs (the sheet may be replaced by a
            // deep link meanwhile); it goes only once the save succeeded, so a failure that
            // lands after the sheet closed leaves the draft to come back to.
            if failure == nil { shell.drafts.discard(mode) }
            return failure
        }
    }

    static func fresh(_ mode: EntryEditor.Mode, today: CalendarDate, ledger: Ledger) -> EntryEditor {
        switch mode {
        case .new: EntryEditor(new: .expense, today: today, ledger: ledger)
        case .edit(let entry): EntryEditor(editing: entry)
        }
    }

    private var showsKeypad: Bool { sizeClass != .regular && !titleFocused }

    @ViewBuilder
    private func form(_ model: EntryFormModel) -> some View {
        @Bindable var model = model
        let draft = model.draft
        ScrollView {
            VStack(spacing: 16) {
                banners(model)
                Picker(
                    "Type", selection: Binding(get: { draft.kind }, set: { model.editor.setKind($0, ledger: ledger) })
                ) {
                    ForEach(EntryKind.allCases, id: \.self) { Text(EntryText.kind($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("entryForm.kind")
                amount(model)
                TextField("What was it for?", text: $model.editor.draft.title)
                    .nameEntry()
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .font(.title3)
                    .padding(.horizontal, 16)
                    .frame(minHeight: ControlSize.button)
                    .background(
                        PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                    )
                    .accessibilityLabel("Name")
                    .accessibilityIdentifier("entryForm.title")
                EntryCategoryChips(
                    kind: draft.kind, selection: $model.editor.draft.categoryId, ledger: ledger,
                    more: { overlay = .category })
                rows(model)
                if let date = CalendarDate.ledgerDate(draft.date), date > shell.today {
                    StatusBanner(
                        tone: .info, title: "\(EntryText.day(date, today: shell.today)) is still ahead",
                        message:
                            "Penny records this entry now. It counts in \(MonthPicker.title(MonthKey(date), long: true))'s totals."
                    )
                    .accessibilityIdentifier("entryForm.futureDate")
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(PennyColor.background)
        .safeAreaInset(edge: .bottom) {
            if showsKeypad {
                AmountKeypad { key in model.editor.draft.amount = AmountInput.apply(key, to: model.draft.amount) }
            }
        }
        .navigationTitle(model.editor.isNew ? "Add entry" : "Edit entry")
        .toolbarTitleDisplayModeInline()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { close(model) }
                    .accessibilityIdentifier("entryForm.close")
            }
            ToolbarItem(placement: .confirmationAction) {
                EntrySaveButton(saving: model.editor.isSaving) { save(model) }
            }
        }
        .navigationDestination(for: EntryFormPage.self) { page in
            switch page {
            case .account:
                EntryAccountPicker(selection: $model.editor.draft.accountId, ledger: ledger)
            case .details:
                EntryExtrasView(model: model, ledger: ledger, save: { save(model) })
            }
        }
        .sheet(item: $overlay) { overlay in
            switch overlay {
            case .date:
                EntryDatePickerSheet(date: $model.editor.draft.date, today: shell.today)
            case .split:
                EntrySplitSheet(draft: $model.editor.draft, currency: ledger.currency.rawValue)
            case .category:
                EntryCategoryPickerSheet(
                    kind: draft.kind, selection: $model.editor.draft.categoryId, ledger: ledger,
                    editCategories: { editCategories() })
            }
        }
        .interactiveDismissDisabled(model.editor.isDirty && !model.editor.isSaved)
        .confirmationDialog("Close this entry?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { finish(discard: true) }
                .accessibilityIdentifier("entryForm.discard")
            Button("Keep as draft") { finish(discard: false) }
                .accessibilityIdentifier("entryForm.keepDraft")
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("Keep it as a draft to finish later, or discard what you entered.")
        }
        .sensoryFeedback(.error, trigger: model.refusedCount)
        // The shelf always holds the latest unsaved draft while the sheet is open, so a sheet
        // replaced by a deep link or Settings (even from a pushed page) leaves it behind. Save
        // and Discard remove it.
        .onChange(of: model.editor) {
            if !closing { shell.drafts.keep(model.editor) }
        }
    }

    // MARK: Parts

    @ViewBuilder
    private func banners(_ model: EntryFormModel) -> some View {
        if restored {
            StatusBanner(tone: .info, title: "Your unsaved entry is back") {
                InlineActionButton("Discard") {
                    model.editor = Self.fresh(mode, today: shell.today, ledger: ledger)
                    restored = false
                }
                .accessibilityIdentifier("entryForm.discardDraft")
            }
            .accessibilityIdentifier("entryForm.restoredDraft")
        }
        if entryGone {
            StatusBanner(
                tone: .error, title: "This entry was deleted",
                message: "It was deleted on another device, so there is nothing left to edit."
            ) {
                InlineActionButton("Close") { finish(discard: true) }
            }
            .accessibilityIdentifier("entryForm.deleted")
        } else if let failure = model.editor.failure {
            if model.editor.hasConflict {
                StatusBanner(tone: .error, title: "Changed on another device", message: failure.message) {
                    InlineActionButton("Review latest") {
                        if !model.reviewLatest(in: ledger) { entryGone = true }
                    }
                    .accessibilityIdentifier("entryForm.reviewLatest")
                }
                .accessibilityIdentifier("entryForm.conflict")
            } else {
                StatusBanner(tone: .error, title: "Couldn't save", message: failure.message) {
                    if failure.rule == nil {
                        InlineActionButton("Try again") { save(model) }
                            .accessibilityIdentifier("entryForm.retry")
                    }
                }
                .accessibilityIdentifier("banner.saveError")
            }
        }
    }

    @ViewBuilder
    private func amount(_ model: EntryFormModel) -> some View {
        @Bindable var model = model
        let draft = model.draft
        let currency = ledger.currency.rawValue
        VStack(spacing: 6) {
            if sizeClass == .regular {
                TextField("0.00", text: $model.editor.draft.amount)
                    .decimalEntry()
                    .multilineTextAlignment(.center)
                    .modifier(HeroAmountFont())
                    .foregroundStyle(EntryText.meaning(draft.kind).color)
                    .accessibilityLabel("Amount")
                    .accessibilityIdentifier("entryForm.amount")
            } else {
                Button {
                    titleFocused = false
                } label: {
                    AmountDisplay(text: draft.amount, kind: draft.kind, currency: currency)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Amount")
                .accessibilityValue(draft.amount.isEmpty ? "Empty" : draft.amount)
                .accessibilityHint("Use the keypad below to type the amount.")
                .accessibilityIdentifier("entryForm.amount")
            }
            Text(currency)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(PennyColor.fill, in: Capsule())
                .accessibilityLabel("Currency \(currency)")
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func rows(_ model: EntryFormModel) -> some View {
        let draft = model.draft
        let currency = ledger.currency.rawValue
        VStack(spacing: 0) {
            Button {
                overlay = .date
            } label: {
                EntryFieldRow(
                    "Date", systemImage: "calendar",
                    value: CalendarDate.ledgerDate(draft.date).map { EntryText.day($0, today: shell.today) }
                        ?? draft.date)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("entryForm.date")
            Divider().padding(.leading, 52)
            NavigationLink(value: EntryFormPage.account) {
                EntryFieldRow(
                    "Account", systemImage: "creditcard",
                    value: draft.accountId.flatMap(ledger.account(id:))?.name ?? "None", chevron: true)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("entryForm.account")
            if draft.kind == .expense {
                Divider().padding(.leading, 52)
                Button {
                    overlay = .split
                } label: {
                    EntryFieldRow("Split", systemImage: "person.2", value: splitValue(draft, currency: currency))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("entryForm.split")
            }
            Divider().padding(.leading, 52)
            NavigationLink(value: EntryFormPage.details) {
                EntryFieldRow(
                    draft.kind == .expense ? "Receipt, repeat, trip" : "Repeat, note", systemImage: "ellipsis",
                    value: detailsValue(draft), chevron: true)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("entryForm.details")
        }
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }

    private func splitValue(_ draft: EntryDraft, currency: String) -> String {
        guard draft.split != .full else { return "All mine" }
        guard let share = draft.previewShare else { return "Check the split" }
        if draft.split == .equal {
            return "\(draft.shareInput) ways · \(MoneyFormat.amount(share, currency: currency)) yours"
        }
        return "\(MoneyFormat.amount(share, currency: currency)) yours"
    }

    private func detailsValue(_ draft: EntryDraft) -> String {
        var parts: [String] = []
        if draft.kind == .expense, draft.receipt != nil { parts.append("Receipt") }
        if model?.editor.isNew == true, let frequency = draft.frequency { parts.append(EntryText.frequency(frequency)) }
        if draft.kind == .expense, let trip = draft.tripId.flatMap(ledger.trip(id:)) { parts.append(trip.name) }
        if !draft.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parts.append("Note") }
        return parts.joined(separator: " · ")
    }

    // MARK: Actions

    private func save(_ model: EntryFormModel) {
        titleFocused = false
        Task {
            guard let ledger = shell.workspace.load.ledger else { return }
            let saved = await model.save(in: ledger) { entry, isNew in
                EntrySummary.saved(entry, isNew: isNew, ledger: ledger)
            }
            if saved { finish(discard: true) }
        }
    }

    private func close(_ model: EntryFormModel) {
        if model.editor.isDirty, !model.editor.isSaved {
            confirmClose = true
        } else {
            finish(discard: true)
        }
    }

    /// Closes the sheet; `discard` drops the draft, otherwise it is kept for next time.
    private func finish(discard: Bool) {
        closing = discard
        if discard { shell.drafts.discard(mode) }
        dismissSheet()
    }

    /// Opens Settings › Categories (MAZ-74's page). The draft stays on the shelf and comes
    /// back the next time this form opens.
    private func editCategories() {
        overlay = nil
        // `navigate` closes this sheet first and opens Settings once it has gone: SwiftUI cannot
        // present Settings in the same update that dismisses the edit or Add entry sheet.
        shell.navigate { $0.openSettings(.categories) }
    }

    private func dismissSheet() {
        if case .edit = mode {
            shell.editingEntry = nil
        } else {
            shell.route.isAddEntryPresented = false
        }
        dismiss()
    }
}

/// The toolbar Save: a tinted check, a spinner while saving (it can't be tapped twice).
struct EntrySaveButton: View {
    let saving: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if saving {
                ProgressView()
            } else {
                Label("Save", systemImage: "checkmark")
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(PennyColor.tint)
        .disabled(saving)
        .accessibilityLabel(saving ? "Saving" : "Save")
        .accessibilityIdentifier("entryForm.save")
    }
}

/// The typed amount, large, with the kind's sign and color. Shows what was typed (so "12."
/// stays visible while typing) with the locale's decimal separator.
struct AmountDisplay: View {
    let text: String
    let kind: EntryKind
    let currency: String

    var body: some View {
        let separator = Locale.current.decimalSeparator ?? "."
        let typed = text.isEmpty ? "0" : text.replacingOccurrences(of: ".", with: separator)
        let sign = kind == .income ? "+" : ""
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(sign + Self.symbol(currency)).foregroundStyle(PennyColor.secondaryLabel)
            Text(typed).foregroundStyle(text.isEmpty ? PennyColor.tertiaryLabel : EntryText.meaning(kind).color)
        }
        .modifier(HeroAmountFont())
        .lineLimit(1)
        .minimumScaleFactor(0.4)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    static func symbol(_ code: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        return formatter.currencySymbol ?? code
    }
}

/// The decimal keypad under the iPhone form (design-kit `Keypad`).
struct AmountKeypad: View {
    let press: (AmountInput.Key) -> Void
    @ScaledMetric(relativeTo: .title2) private var height = 48.0

    var body: some View {
        let separator = Locale.current.decimalSeparator ?? "."
        Grid(horizontalSpacing: 8, verticalSpacing: 8) {
            ForEach(0..<3) { row in
                GridRow {
                    ForEach(1...3, id: \.self) { column in
                        let digit = row * 3 + column
                        key("\(digit)", id: "\(digit)") { press(.digit(digit)) }
                    }
                }
            }
            GridRow {
                key(separator, id: "separator", label: "Decimal separator") { press(.separator) }
                key("0", id: "0") { press(.digit(0)) }
                key("", id: "delete", systemImage: "delete.left", label: "Delete") { press(.delete) }
            }
        }
        .padding(8)
        .background(PennyColor.secondarySurface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Amount keypad")
    }

    private func key(
        _ title: String, id: String, systemImage: String? = nil, label: String? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if let systemImage { Image(systemName: systemImage) } else { Text(title) }
            }
            .font(.title2)
            .foregroundStyle(PennyColor.label)
            .frame(maxWidth: .infinity, minHeight: max(height, Metrics.minTouchTarget))
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label ?? title)
        .accessibilityIdentifier("keypad.\(id)")
    }
}

/// A labeled row in the entry form: icon, title, the selected value, and a chevron when it
/// opens a page.
struct EntryFieldRow: View {
    let title: String
    let systemImage: String
    let value: String
    let chevron: Bool

    init(_ title: String, systemImage: String, value: String, chevron: Bool = false) {
        self.title = title
        self.systemImage = systemImage
        self.value = value
        self.chevron = chevron
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(title).foregroundStyle(PennyColor.label)
            Spacer(minLength: 8)
            Text(value)
                .foregroundStyle(PennyColor.secondaryLabel)
                .lineLimit(1)
                .multilineTextAlignment(.trailing)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: ControlSize.row)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The most used categories of the entry's kind as chips, the selected one always visible,
/// and a More chip that opens every category.
struct EntryCategoryChips: View {
    let kind: EntryKind
    @Binding var selection: String
    let ledger: Ledger
    let more: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.chips(kind: kind, selection: selection, ledger: ledger), id: \.id) { category in
                    chip(category)
                }
                Button(action: more) {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(PennyColor.label)
                        .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
                        .background(PennyColor.fill, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("All categories")
                .accessibilityIdentifier("entryForm.moreCategories")
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Category")
    }

    /// The three most used categories, with the selected one first when it isn't among them.
    static func chips(kind: EntryKind, selection: String, ledger: Ledger) -> [LedgerCategory] {
        var chips = Array(ledger.categoriesByUse(kind).prefix(3))
        if !chips.contains(where: { $0.id == selection }), let selected = ledger.category(id: selection),
            selected.kind == kind
        {
            chips.insert(selected, at: 0)
        }
        return chips
    }

    private func chip(_ category: LedgerCategory) -> some View {
        let selected = category.id == selection
        let color = EntryText.color(category, id: category.id)
        return Button {
            selection = category.id
        } label: {
            Label(category.name, systemImage: EntryText.symbol(category))
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: Metrics.minTouchTarget)
                .foregroundStyle(selected ? Color.white : PennyColor.label)
                .background(selected ? color : PennyColor.fill, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("entryForm.category.\(category.id)")
    }
}
