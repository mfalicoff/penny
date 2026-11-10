import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Inline creation from the entry form's pickers (MAZ-73): a small sheet over the picker that
// adds one account or category and selects it, while the entry draft stays as typed. These
// are deliberately minimal and picker-local; the full account and category forms (editing,
// removal, usage) are MAZ-74's, and these sheets should be consolidated with them.

/// Adds a payment account from the account picker and selects it.
struct InlineAccountCreateSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let onCreated: (String) -> Void
    @State private var name = ""
    @State private var type: AccountType = .credit
    @State private var failure: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, like Visa or Main chequing", text: $name)
                        .nameEntry()
                        .accessibilityIdentifier("inlineAccount.name")
                    Picker("Type", selection: $type) {
                        Text("Bank").tag(AccountType.bank)
                        Text("Credit card").tag(AccountType.credit)
                        Text("Cash").tag(AccountType.cash)
                        Text("Other").tag(AccountType.other)
                    }
                    .accessibilityIdentifier("inlineAccount.type")
                } footer: {
                    Text("An account is a label for which card or account paid, not a balance.")
                }
                if let failure {
                    Section {
                        Text(failure).foregroundStyle(PennyColor.danger)
                            .accessibilityIdentifier("inlineAccount.error")
                    }
                }
            }
            .navigationTitle("New account")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("inlineAccount.save")
                }
            }
        }
        .presentationDetents([.medium])
        .accessibilityIdentifier("screen.inlineAccount")
    }

    private func save() {
        guard !saving else { return }
        saving = true
        let account = PaymentAccount(id: UUID().uuidString.lowercased(), name: name, type: type)
        Task {
            let result = await shell.commit(
                .saveAccount(account), summary: ChangeSummary(title: "Account added", detail: account.name))
            saving = false
            if let result {
                failure = result.message
            } else {
                onCreated(account.id)
                dismiss()
            }
        }
    }
}

/// Adds a category of the entry's kind from the category picker and selects it.
struct InlineCategoryCreateSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let kind: EntryKind
    let onCreated: (String) -> Void
    @State private var name: String
    @State private var icon = "pricetag-outline"
    @State private var color = Ledger.palette[0]
    @State private var failure: String?
    @State private var saving = false

    init(kind: EntryKind, suggestedName: String = "", onCreated: @escaping (String) -> Void) {
        self.kind = kind
        self.onCreated = onCreated
        _name = State(initialValue: suggestedName.trimmingCharacters(in: .whitespaces))
    }

    /// Ionicons names the ledger stores; each maps to an SF Symbol (`CategoryStyle`).
    static let icons = [
        "pricetag-outline", "cart-outline", "restaurant-outline", "car-outline", "airplane-outline",
        "medkit-outline", "school-outline", "paw-outline", "flash-outline", "shirt-outline", "game-controller-outline",
        "cash-outline",
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .nameEntry()
                        .accessibilityIdentifier("inlineCategory.name")
                }
                Section("Icon") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], spacing: 8) {
                        ForEach(Self.icons, id: \.self) { item in
                            Button {
                                icon = item
                            } label: {
                                Image(systemName: CategoryStyle.symbol(forIonicon: item))
                                    .frame(width: 44, height: 44)
                                    .background(
                                        icon == item ? PennyColor.fill : .clear,
                                        in: RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(CategoryStyle.symbol(forIonicon: item))
                            .accessibilityAddTraits(icon == item ? .isSelected : [])
                        }
                    }
                }
                Section("Color") {
                    HStack {
                        ForEach(Ledger.palette, id: \.self) { item in
                            Button {
                                color = item
                            } label: {
                                Circle()
                                    .fill(Self.color(item))
                                    .frame(width: 32, height: 32)
                                    .overlay(Circle().stroke(color == item ? PennyColor.label : .clear, lineWidth: 2))
                                    .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Color \(item)")
                            .accessibilityAddTraits(color == item ? .isSelected : [])
                        }
                    }
                }
                if let failure {
                    Section {
                        Text(failure).foregroundStyle(PennyColor.danger)
                            .accessibilityIdentifier("inlineCategory.error")
                    }
                }
            }
            .navigationTitle("New category")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("inlineCategory.save")
                }
            }
        }
        .presentationDetents([.large])
        .accessibilityIdentifier("screen.inlineCategory")
    }

    static func color(_ hex: String) -> Color {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0
        return Color(
            .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255)
    }

    private func save() {
        guard !saving else { return }
        saving = true
        let category = LedgerCategory(
            id: UUID().uuidString.lowercased(), name: name, icon: icon, color: color, kind: kind)
        Task {
            let result = await shell.commit(
                .saveCategory(category), summary: ChangeSummary(title: "Category added", detail: category.name))
            saving = false
            if let result {
                failure = result.message
            } else {
                onCreated(category.id)
                dismiss()
            }
        }
    }
}
