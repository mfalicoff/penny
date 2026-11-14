import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// What Add entry carries when a new expense moves between the personal ledger and a household,
/// so choosing where it goes never loses what was typed. The category travels by name (shared
/// expenses store it by value, personal entries by the ledger's id); the account only while the
/// viewer pays.
struct EntryHandoff: Equatable {
    /// The amount as the keypad types it ("12.5": a dot, whatever the locale).
    var amount: String
    var title: String
    var date: CalendarDate?
    var categoryName: String?
    var accountId: String?
    var note: String
    /// The kind the personal form opens on (Expense, unless Income or Investment was chosen).
    var kind: EntryKind = .expense

    init(_ draft: EntryDraft, ledger: Ledger) {
        amount = draft.amount
        title = draft.title
        date = CalendarDate.ledgerDate(draft.date)
        categoryName = ledger.category(id: draft.categoryId)?.name
        accountId = draft.accountId
        note = draft.note
    }

    init(_ draft: SharedExpenseDraft, viewerId: String?, kind: EntryKind = .expense) {
        amount = draft.amountText.replacingOccurrences(of: ",", with: ".")
        title = draft.title
        date = draft.date
        categoryName = draft.category.name
        accountId = draft.payerId == viewerId ? draft.accountId : nil
        note = draft.note
        self.kind = kind
    }

    /// Fills a new shared expense paid by the viewer.
    func apply(to draft: inout SharedExpenseDraft, ledger: Ledger?) {
        draft.amountText = amount
        draft.title = title
        if let date { draft.date = date }
        if let name = categoryName,
            let category = ledger?.categories.first(where: { $0.kind == .expense && $0.name == name })
        {
            draft.category = WireSharedCategory(category)
        }
        if let accountId, ledger?.account(id: accountId) != nil { draft.accountId = accountId }
        draft.note = note
    }

    /// Fills a new personal entry of `kind`.
    func apply(to editor: inout EntryEditor, ledger: Ledger) {
        if kind != editor.draft.kind { editor.setKind(kind, ledger: ledger) }
        editor.draft.amount = amount
        editor.draft.title = title
        if let date { editor.draft.date = date.description }
        if let name = categoryName,
            let category = ledger.categories.first(where: { $0.kind == kind && $0.name == name })
        {
            editor.draft.categoryId = category.id
        }
        if let accountId, ledger.account(id: accountId) != nil { editor.draft.accountId = accountId }
        editor.draft.note = note
    }
}

/// Add entry's choice of where a new expense goes: Personal (`nil`) or a household.
struct EntryScope {
    /// The households and shared trips the account belongs to.
    let households: [WireHousehold]
    /// The household the form is for, or nil for a personal entry.
    let current: String?
    let choose: (_ householdId: String?, _ handoff: EntryHandoff) -> Void

    func name(of id: String?) -> String {
        guard let id else { return "Personal" }
        return households.first { $0.id == id }?.name ?? "Shared"
    }
}

/// The Household picker: Personal, then each household and shared trip. Picking one closes the
/// sheet; the form switches once it has gone (`onDismiss`), keeping what was typed.
struct EntryHouseholdSheet: View {
    @Environment(\.dismiss) private var dismiss
    let households: [WireHousehold]
    let current: String?
    let choose: (String?) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row(nil, title: "Personal", detail: "Only you", symbol: "person")
                } footer: {
                    Text("Your share counts in your spending either way.")
                }
                if !households.isEmpty {
                    Section {
                        ForEach(households) { household in
                            let members = "\(household.memberCount) members"
                            row(
                                household.id, title: household.name,
                                detail: household.trip == nil ? members : "Shared trip · \(members)",
                                symbol: household.trip == nil ? "house" : "airplane")
                        }
                    } header: {
                        Text("Split with")
                    } footer: {
                        Text("Everyone in the household sees the full amount. Shared expenses need a connection.")
                    }
                }
            }
            .insetGroupedList()
            .background(PennyColor.background)
            .navigationTitle("Household")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("screen.householdPicker")
    }

    private func row(_ id: String?, title: String, detail: String, symbol: String) -> some View {
        let selected = id == current
        let option = id ?? "personal"
        return Button {
            choose(id)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(PennyColor.label)
                    Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").foregroundStyle(PennyColor.tint).accessibilityHidden(true)
                }
            }
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("householdPicker.\(option)")
    }
}
