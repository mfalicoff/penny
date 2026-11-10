import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Categories (`categories` card): one kind at a time, each category with what uses it.
/// Tapping a row edits it; + adds one of the kind shown.
struct CategoriesListView: View {
    @Environment(ShellModel.self) private var shell
    @State private var kind: EntryKind = .expense
    @State private var form: CategoryFormRequest?

    var body: some View {
        WorkspaceContent { ledger in
            let categories = ledger.categories.filter { $0.kind == kind }
            List {
                Section {
                    Picker("Kind", selection: $kind) {
                        ForEach(EntryKind.allCases, id: \.self) { kind in
                            Text(OrganizeText.kind(kind)).tag(kind)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("categories.kind")
                }
                Section {
                    ForEach(categories, id: \.id) { category in
                        Button {
                            form = CategoryFormRequest(category: category, kind: category.kind)
                        } label: {
                            CategoryRow(category: category, usage: ledger.usage(ofCategory: category.id))
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Edit")
                        .accessibilityIdentifier("category.\(category.id)")
                    }
                } header: {
                    Text(OrganizeText.count(categories.count, "category", "categories"))
                } footer: {
                    Text("A category with entries or schedules can be renamed and restyled, but not removed.")
                }
            }
            .insetGroupedList()
            .overlay {
                if categories.isEmpty {
                    PennyStateView(
                        .empty, title: "No \(OrganizeText.kind(kind).lowercased()) categories",
                        message: "Add one to sort your \(OrganizeText.kindPlural(kind).lowercased()).",
                        actionTitle: "Add category"
                    ) { form = CategoryFormRequest(category: nil, kind: kind) }
                }
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Categories")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add category", systemImage: "plus") { form = CategoryFormRequest(category: nil, kind: kind) }
                    .disabled(shell.workspace.load.ledger == nil)
                    .accessibilityIdentifier("categories.add")
            }
        }
        .sheet(item: $form) { request in
            CategoryFormSheet(category: request.category, kind: request.kind).environment(shell)
        }
        .accessibilityIdentifier("screen.categories")
    }
}

struct CategoryFormRequest: Identifiable {
    let id = UUID()
    let category: LedgerCategory?
    let kind: EntryKind
}

private struct CategoryRow: View {
    let category: LedgerCategory
    let usage: RecordUsage

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: CategoryStyle.symbol(forIonicon: category.icon),
                color: PennyColor.category(category.paletteColor))
            VStack(alignment: .leading, spacing: 2) {
                Text(category.name).font(.body).foregroundStyle(PennyColor.label)
                Text(OrganizeText.categoryDetail(usage)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.tertiaryLabel)
                .accessibilityHidden(true)
        }
        .frame(minHeight: ControlSize.row)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The category form (`category-form` card), as a sheet: name, kind, a palette color and an
/// icon. Reusable like `AccountFormSheet`: an entry or schedule form presents it inline with
/// the draft's kind, and `onSaved` returns the stored category so the caller can select it.
///
/// ```swift
/// .sheet(isPresented: $addingCategory) {
///     CategoryFormSheet(kind: draft.kind) { category in draft.categoryId = category.id }
/// }
/// ```
///
/// A failed save keeps the sheet and the draft. Editing offers Remove, unavailable with the
/// reason while entries or schedules use the category; their kind is locked for the same reason.
struct CategoryFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model: CategoryFormModel
    @State private var confirmingRemoval = false
    @FocusState private var nameFocused: Bool
    private let onSaved: ((LedgerCategory) -> Void)?

    init(category: LedgerCategory? = nil, kind: EntryKind = .expense, onSaved: ((LedgerCategory) -> Void)? = nil) {
        _model = State(initialValue: CategoryFormModel(category: category, kind: kind))
        self.onSaved = onSaved
    }

    var body: some View {
        let ledger = shell.workspace.load.ledger ?? Ledger(categories: [])
        let usage = ledger.usage(ofCategory: model.id)
        let tint = PennyColor.category(model.paletteColor)
        NavigationStack {
            List {
                Section {
                    CategoryIcon(symbol: CategoryStyle.symbol(forIonicon: model.icon), color: tint, size: 72)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                failureSection
                Section("Name") {
                    TextField("Coffee, Rent, Side gig", text: $model.name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityLabel("Category name")
                        .accessibilityIdentifier("categoryForm.name")
                }
                Section {
                    Picker("Kind", selection: $model.kind) {
                        ForEach(EntryKind.allCases, id: \.self) { Text(OrganizeText.kind($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(!model.canChangeKind(in: ledger))
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("categoryForm.kind")
                } footer: {
                    if !model.canChangeKind(in: ledger) {
                        Text(LedgerRuleError.categoryKindInUse.message)
                    }
                }
                Section("Color") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 48), spacing: 10)], spacing: 10) {
                        ForEach(CategoryStyle.pickerColors, id: \.self) { color in
                            ColorSwatch(color: color, selected: model.paletteColor == color) { model.choose(color) }
                        }
                    }
                    .padding(.vertical, 6)
                }
                Section("Icon") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 10)], spacing: 10) {
                        ForEach(CategoryStyle.pickerIcons, id: \.self) { icon in
                            IconChoice(
                                icon: icon, tint: tint, selected: CategoryStyle.sameIcon(model.icon, icon)
                            ) { model.icon = icon }
                        }
                    }
                    .padding(.vertical, 6)
                }
                if !model.isNew {
                    removeSection(usage: usage)
                }
            }
            .insetGroupedList()
            .background(PennyColor.background)
            .disabled(model.isSaving)
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("categoryForm.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark", action: save)
                        .disabled(!model.canSave)
                        .accessibilityIdentifier("categoryForm.save")
                }
            }
            .confirmationDialog(
                "Remove \(model.original?.name ?? "category")?", isPresented: $confirmingRemoval,
                titleVisibility: .visible
            ) {
                Button("Remove category", role: .destructive, action: remove)
                    .accessibilityIdentifier("categoryForm.removeConfirm")
            } message: {
                Text("Nothing uses this category, so no entry changes.")
            }
        }
        .tint(PennyColor.tint)
        .interactiveDismissDisabled(model.isSaving)
        .onAppear { if model.isNew { nameFocused = true } }
        .accessibilityIdentifier("screen.categoryForm")
    }

    @ViewBuilder
    private var failureSection: some View {
        if let failure = model.failure {
            let retry: (() -> Void)? = model.canSave ? { save() } : nil
            Section {
                SaveErrorBanner(failure: failure, retry: retry)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
        }
    }

    private func removeSection(usage: RecordUsage) -> some View {
        let note = CategoryFormModel.removalNote(name: model.original?.name ?? "", usage: usage)
        return Section {
            Button(role: .destructive) {
                confirmingRemoval = true
            } label: {
                Label("Remove category", systemImage: note == nil ? "trash" : "lock")
                    .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
            }
            .disabled(note != nil)
            .accessibilityHint(note ?? "")
            .accessibilityIdentifier("categoryForm.remove")
        } footer: {
            if let note {
                Text(note).accessibilityIdentifier("categoryForm.removeReason")
            }
        }
    }

    private func save() {
        Task {
            guard let category = await model.save(with: { await shell.commit($0, summary: $1) }) else { return }
            onSaved?(category)
            dismiss()
        }
    }

    private func remove() {
        Task {
            if await model.remove(with: { await shell.commit($0, summary: $1) }) { dismiss() }
        }
    }
}

private struct ColorSwatch: View {
    let color: CategoryColor
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(PennyColor.category(color))
                .frame(width: 36, height: 36)
                .padding(4)
                .overlay { Circle().stroke(selected ? PennyColor.label : .clear, lineWidth: 2.5) }
                .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CategoryStyle.colorName(color))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("categoryForm.color.\(color.rawValue)")
    }
}

private struct IconChoice: View {
    let icon: String
    let tint: Color
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: CategoryStyle.symbol(forIonicon: icon))
                .font(.title3)
                .foregroundStyle(selected ? Color.white : PennyColor.label)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(
                    selected ? tint : PennyColor.fill,
                    in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CategoryStyle.iconName(icon))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("categoryForm.icon.\(icon)")
    }
}
