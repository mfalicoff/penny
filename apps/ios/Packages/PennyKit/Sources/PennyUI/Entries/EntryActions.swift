import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Opens the entry form on a recorded entry (`ShellModel.editingEntry`).
struct EntryEditRequest: Identifiable, Equatable {
    let entry: LedgerEntry
    var id: String { entry.id }
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

/// The delete confirmation (`delete-confirm` card) for one entry, shared by Activity's swipe
/// action and the entry detail: the entry's tile, "Delete “Groceries”?" with "$48.90 · Nov 6 ·
/// Main chequing", what deleting does, then Delete entry and Cancel. Deleting is never one tap:
/// it always asks first.
struct DeleteEntryConfirmation: ViewModifier {
    @Environment(ShellModel.self) private var shell
    @Binding var entry: LedgerEntry?
    var onDeleted: () -> Void = {}
    @State private var failure: String?
    @State private var deleting = false

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: Binding(get: { entry != nil }, set: { if !$0 { entry = nil } })) {
                if let target = entry {
                    DeleteConfirmationSheet(subject: subject(target)) { delete(target) }
                }
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

    /// "$48.90 · Nov 6 · Main chequing": the total, the day and the account, as on the card.
    static func detail(total: Int64, date: CalendarDate, place: String?, currency: String) -> String {
        let day = DayText.date(date).formatted(.dateTime.month(.abbreviated).day())
        return ([MoneyFormat.amount(total, currency: currency), day] + [place].compactMap { $0 })
            .joined(separator: " · ")
    }

    private func subject(_ target: LedgerEntry) -> DeleteConfirmationSheet.Subject {
        let ledger = shell.workspace.load.ledger
        let category = ledger?.category(id: target.categoryId)
        return DeleteConfirmationSheet.Subject(
            title: target.title,
            detail: Self.detail(
                total: target.total, date: target.date,
                place: target.accountId.flatMap { ledger?.account(id: $0) }?.name,
                currency: shell.currency),
            symbol: EntryText.tileSymbol(target.kind, category: category),
            color: EntryText.tileColor(target.kind, category: category, id: target.categoryId),
            noteSymbol: target.recurringId == nil ? "arrow.uturn.backward" : "repeat",
            note: Self.message(target), confirmTitle: "Delete entry")
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

/// A shared expense to delete for everyone (`delete-confirm` card), from Activity's row or the
/// expense's own page.
struct SharedDeleteRequest: Identifiable, Equatable {
    let householdId: String
    let expenseId: String
    let title: String
    let total: Int64
    let date: CalendarDate
    let householdName: String
    let symbol: String
    let color: Color
    var id: String { "\(householdId):\(expenseId)" }

    init(
        householdId: String, expenseId: String, title: String, total: Int64, date: CalendarDate,
        householdName: String, symbol: String, color: Color
    ) {
        self.householdId = householdId
        self.expenseId = expenseId
        self.title = title
        self.total = total
        self.date = date
        self.householdName = householdName
        self.symbol = symbol
        self.color = color
    }

    /// Activity's shared row; nil for a personal row.
    init?(_ entry: ReportEntry, report: LedgerReport) {
        guard case .shared(let household, let expense) = entry.source else { return nil }
        let category = report.categories.first { $0.id == entry.categoryId }
        self.init(
            householdId: household, expenseId: expense, title: entry.title, total: entry.total, date: entry.date,
            householdName: entry.householdName ?? "", symbol: EntryText.tileSymbol(entry.kind, category: category),
            color: EntryText.tileColor(entry.kind, category: category, id: entry.categoryId))
    }

    /// "This expense is shared. Deleting it removes it for bea@example.test and jo@example.test too,
    /// and recalculates November balances."
    static func note(others: [String], month: String) -> String {
        let people: String =
            switch others.count {
            case 0: "everyone in the household"
            case 1: others[0]
            default: others.dropLast().joined(separator: ", ") + " and " + others[others.count - 1]
            }
        return "This expense is shared. Deleting it removes it for \(people) too, and recalculates \(month) balances."
    }
}

/// Confirms deleting a shared expense for everyone, then deletes the latest version of it. The
/// server refuses an expense someone has repaid; the alert says why.
struct SharedDeleteConfirmation: ViewModifier {
    @Environment(ShellModel.self) private var shell
    @Binding var request: SharedDeleteRequest?
    var onDeleted: () -> Void = {}
    @State private var failure: String?

    func body(content: Content) -> some View {
        content
            .sheet(item: $request) { target in
                DeleteConfirmationSheet(subject: subject(target)) { delete(target) }
                    .task { await shell.households.model(for: target.householdId)?.refresh() }
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

    private func subject(_ target: SharedDeleteRequest) -> DeleteConfirmationSheet.Subject {
        let people = shell.households.model(for: target.householdId)?.people
        let current = people?.current ?? []
        let others = current.filter { $0.userId != people?.meId }.map(\.shownName)
        let month = MonthPicker.title(MonthKey(target.date), long: false)
        let currency = shell.households.model(for: target.householdId)?.currency ?? shell.currency
        return DeleteConfirmationSheet.Subject(
            title: target.title,
            detail: DeleteEntryConfirmation.detail(
                total: target.total, date: target.date,
                place: target.householdName.isEmpty ? nil : target.householdName,
                currency: currency),
            symbol: target.symbol, color: target.color,
            members: current.map { people?.face($0.userId) ?? PersonFace(initials: "?") },
            noteSymbol: "person.2", note: SharedDeleteRequest.note(others: others, month: month),
            confirmTitle: "Delete for everyone")
    }

    private func delete(_ target: SharedDeleteRequest) {
        guard let model = shell.households.model(for: target.householdId) else {
            failure = "Shared expenses need your account."
            return
        }
        Task {
            switch await model.loadExpense(target.expenseId) {
            case .success(let expense):
                if let refused = await model.deleteExpense(expense) {
                    failure = refused.message
                } else {
                    await shell.activityShared.refresh(shell.activityFilters.period)
                    onDeleted()
                }
            case .failure(let refused):
                failure = refused.message
            }
        }
    }
}

extension View {
    func deleteEntryConfirmation(_ entry: Binding<LedgerEntry?>, onDeleted: @escaping () -> Void = {}) -> some View {
        modifier(DeleteEntryConfirmation(entry: entry, onDeleted: onDeleted))
    }

    func sharedDeleteConfirmation(_ request: Binding<SharedDeleteRequest?>, onDeleted: @escaping () -> Void = {})
        -> some View
    {
        modifier(SharedDeleteConfirmation(request: request, onDeleted: onDeleted))
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

    /// The Repeat row's value: "Never", "Weekly on Sunday", "Monthly on the 15th" or "Yearly on
    /// November 15", from the entry's date (the schedule's anchor).
    static func repeats(_ frequency: RecurrenceFrequency?, on date: CalendarDate?) -> String {
        guard let frequency else { return "Never" }
        guard let date else { return self.frequency(frequency) }
        switch frequency {
        case .weekly: return "Weekly on \(ScheduleText.weekday(date))"
        case .monthly: return "Monthly on the \(ScheduleText.ordinal(date.day))"
        case .yearly: return "Yearly on \(ScheduleText.monthName(date.month)) \(date.day)"
        }
    }

    /// The iPad save capsule: "Add expense", "Add income", "Add investment"; "Save" when editing.
    static func saveTitle(_ kind: EntryKind, isNew: Bool) -> String {
        guard isNew else { return "Save" }
        switch kind {
        case .expense: return "Add expense"
        case .income: return "Add income"
        case .investment: return "Add investment"
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

    /// An entry's tile symbol, as on the cards (`.ic`): income and investments draw their kind
    /// (an arrow down, the trend line); expenses draw their category's icon, `fallback` when the
    /// category is missing.
    static func tileSymbol(_ kind: EntryKind, category: LedgerCategory?, fallback: String = "pricetag") -> String {
        switch kind {
        case .income: "arrow.down"
        case .investment: "chart.line.uptrend.xyaxis"
        case .expense: CategoryStyle.symbol(forIonicon: category?.icon ?? fallback)
        }
    }

    /// An entry's tile color, as on the cards: income green and investment indigo; expenses draw
    /// their category's color. A category on its own (pickers, Categories) keeps its own color.
    static func tileColor(_ kind: EntryKind, category: LedgerCategory?, id categoryId: String) -> Color {
        switch kind {
        case .income: PennyColor.income
        case .investment: PennyColor.invest
        case .expense: color(category, id: categoryId)
        }
    }

    /// "Today", "Yesterday", "Sun, Nov 15".
    static func day(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        if day == today.adding(days: 1) { return "Tomorrow" }
        return DayText.date(day).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// The note under a date after today. Income dated ahead is expected (MAZ-136, `add-income`
    /// card); expenses and investments are recorded in that month's totals (MAZ-139 owns them).
    static func futureDate(
        _ kind: EntryKind, date: CalendarDate, today: CalendarDate
    ) -> (title: String, message: String) {
        let day = self.day(date, today: today)
        if kind == .income {
            return (
                "\(day) is still ahead, so this pay shows as expected.",
                "It counts toward Projected until the day it's recorded — not toward Left to spend."
            )
        }
        return (
            "\(day) is still ahead",
            "Penny records this entry now. It counts in \(MonthPicker.title(MonthKey(date), long: true))'s totals."
        )
    }

    static func split(total: Int64, share: Int64, currency: String) -> String {
        share == total ? "All mine" : "\(MoneyFormat.amount(share, currency: currency)) yours"
    }
}
