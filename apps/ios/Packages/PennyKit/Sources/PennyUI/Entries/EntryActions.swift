import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Opens the entry form on a recorded entry (`ShellModel.editingEntry`).
struct EntryEditRequest: Identifiable, Equatable {
    let entry: LedgerEntry
    var id: String { entry.id }
}

/// Where a receipt comes from, for the receipt hook (`ShellModel.attachReceipt`, MAZ-78).
enum ReceiptSource: Equatable {
    case photo
    case file
}

extension ShellModel {
    /// Opens the entry form on `entry`.
    func edit(_ entry: LedgerEntry) {
        editingEntry = EntryEditRequest(entry: entry)
    }

    /// Deletes `entry` as it was shown. Refused when it changed on another device since
    /// (`LedgerChange.deleteEntry`); the toast offers Undo.
    func delete(_ entry: LedgerEntry) async -> SaveFailure? {
        await commit(.deleteEntry(entry), summary: EntrySummary.deleted(entry, currency: currency))
    }
}

/// The save toast's text for entry changes.
enum EntrySummary {
    static func saved(_ entry: LedgerEntry, isNew: Bool, ledger: Ledger) -> ChangeSummary {
        let title: String =
            if isNew {
                switch entry.kind {
                case .expense: "Expense added"
                case .income: "Income added"
                case .investment: "Investment added"
                }
            } else {
                "Entry updated"
            }
        let category = ledger.category(id: entry.categoryId)?.name ?? entry.title
        let currency = ledger.currency.rawValue
        return ChangeSummary(
            title: title, detail: "\(category) · \(MoneyFormat.amount(entry.share, currency: currency))",
            kind: entry.kind, categoryId: entry.categoryId)
    }

    static func deleted(_ entry: LedgerEntry, currency: String) -> ChangeSummary {
        ChangeSummary(
            title: "Entry deleted", detail: "\(entry.title) · \(MoneyFormat.amount(entry.share, currency: currency))",
            kind: entry.kind, categoryId: entry.categoryId)
    }
}

/// The delete confirmation (`delete-entry` card) for one entry, shared by Activity's swipe
/// action and the entry detail. Deleting is never one tap: it always asks first.
struct DeleteEntryConfirmation: ViewModifier {
    @Environment(ShellModel.self) private var shell
    @Binding var entry: LedgerEntry?
    var onDeleted: () -> Void = {}
    @State private var failure: String?
    @State private var deleting = false

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                entry.map { "Delete “\($0.title)”?" } ?? "Delete entry?",
                isPresented: Binding(get: { entry != nil }, set: { if !$0 { entry = nil } }),
                titleVisibility: .visible, presenting: entry
            ) { target in
                Button("Delete entry", role: .destructive) { delete(target) }
                    .accessibilityIdentifier("deleteEntry.confirm")
                Button("Cancel", role: .cancel) {}
                    .accessibilityIdentifier("deleteEntry.cancel")
            } message: { target in
                Text(Self.message(target))
            }
            .alert(
                "Couldn't delete",
                isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
    }

    static func message(_ entry: LedgerEntry) -> String {
        let base = "It's removed from your activity and totals. You can undo right after."
        return entry.recurringId == nil ? base : "\(base) Its schedule keeps running; pause it in Recurring."
    }

    private func delete(_ target: LedgerEntry) {
        // A second confirmation while the first delete runs does nothing.
        guard !deleting else { return }
        deleting = true
        Task {
            let result = await shell.delete(target)
            deleting = false
            if let result {
                failure = result.message
            } else {
                onDeleted()
            }
        }
    }
}

extension View {
    func deleteEntryConfirmation(_ entry: Binding<LedgerEntry?>, onDeleted: @escaping () -> Void = {}) -> some View {
        modifier(DeleteEntryConfirmation(entry: entry, onDeleted: onDeleted))
    }

    /// A decimal amount field: the decimal pad on iOS.
    func decimalEntry() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }

    /// A short name field: words capitalized on iOS.
    func nameEntry() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.sentences)
        #else
            self
        #endif
    }
}

/// Text for entry fields and rows.
enum EntryText {
    static func kind(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "Expense"
        case .income: "Income"
        case .investment: "Invest"
        }
    }

    static func frequency(_ frequency: RecurrenceFrequency?) -> String {
        switch frequency {
        case nil: "Never"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }

    static func meaning(_ kind: EntryKind) -> MoneyMeaning {
        switch kind {
        case .expense: .expense
        case .income: .income
        case .investment: .investment
        }
    }

    static func symbol(_ category: LedgerCategory?) -> String {
        CategoryStyle.symbol(forIonicon: category?.icon ?? "pricetag")
    }

    static func color(_ categoryId: String) -> Color {
        PennyColor.category(CategoryStyle.color(forCategoryID: categoryId))
    }

    /// Uses the stored color, so categories made on this device or another app draw in their own color.
    static func color(_ category: LedgerCategory?, id categoryId: String) -> Color {
        category.map { PennyColor.category($0.paletteColor) } ?? color(categoryId)
    }

    /// "Today", "Yesterday", "Sun, Nov 15".
    static func day(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        if day == today.adding(days: 1) { return "Tomorrow" }
        return DayText.date(day).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    static func split(total: Int64, share: Int64, currency: String) -> String {
        share == total ? "All mine" : "\(MoneyFormat.amount(share, currency: currency)) yours"
    }
}
