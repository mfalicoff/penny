import Foundation
import PennyData
import PennyDesign
import PennyDomain

/// How an organize form saves a change: `ShellModel.commit` in the app, or a test double. It
/// returns nil once the change is kept (offline included), otherwise the failure; a failure
/// changed nothing, so the form keeps the person's draft and shows it.
typealias LedgerCommit = (LedgerChange, ChangeSummary) async -> SaveFailure?

/// New record ids. The legacy app used random ids too; any unique string up to 100 UTF-16
/// units is valid on the wire.
nonisolated enum OrganizeID {
    static func make() -> String { UUID().uuidString.lowercased() }
}

// MARK: Accounts

/// The account form (`account-form` and `account-edit` cards). It holds the draft, so a failed
/// save keeps what was typed, and it creates the id once, so Try again never adds a second
/// account. Presented from Accounts or inline from another form (`AccountFormSheet`).
@MainActor
@Observable
final class AccountFormModel {
    let original: PaymentAccount?
    let id: String
    var name: String
    var type: AccountType
    private(set) var failure: SaveFailure?
    private(set) var isSaving = false

    init(account: PaymentAccount? = nil, type: AccountType = .bank, makeID: () -> String = OrganizeID.make) {
        original = account
        id = account?.id ?? makeID()
        name = account?.name ?? ""
        self.type = account?.type ?? type
    }

    var isNew: Bool { original == nil }
    var title: String { isNew ? "New account" : "Edit account" }
    var canSave: Bool { !isSaving && !PaymentAccount(id: id, name: name, type: type).trimmed().name.isEmpty }

    /// Saves the draft. Returns the stored account (name trimmed), or nil with `failure` set.
    func save(with commit: LedgerCommit) async -> PaymentAccount? {
        guard !isSaving else { return nil }
        isSaving = true
        defer { isSaving = false }
        let account = PaymentAccount(id: id, name: name, type: type).trimmed()
        let summary = ChangeSummary(title: isNew ? "Account added" : "Account updated", detail: account.name)
        failure = await commit(.saveAccount(account, original: original), summary)
        return failure == nil ? account : nil
    }

    /// Removes the account as it was opened. The ledger rule refuses while entries or
    /// schedules use it, and when it changed on another device since.
    func remove(with commit: LedgerCommit) async -> Bool {
        guard let original, !isSaving else { return false }
        isSaving = true
        defer { isSaving = false }
        failure = await commit(
            .saveAccount(original, original: original, remove: true),
            ChangeSummary(title: "Account removed", detail: original.name))
        return failure == nil
    }

    /// Why Remove is unavailable, naming what uses the account; nil when it can be removed.
    static func removalNote(name: String, usage: RecordUsage) -> String? {
        guard usage.isInUse else { return nil }
        return "\(name) is used by \(OrganizeText.uses(usage)). Move them to another account to remove it."
    }
}

// MARK: Categories

/// The category form (`category-form` card): name, kind, a palette color and an icon. The kind
/// can change only while nothing uses the category (`LedgerRuleError.categoryKindInUse`).
@MainActor
@Observable
final class CategoryFormModel {
    let original: LedgerCategory?
    let id: String
    var name: String
    var kind: EntryKind
    /// The stored `#RRGGBB`. An untouched legacy color is saved back unchanged.
    var color: String
    /// The stored Ionicons name.
    var icon: String
    private(set) var failure: SaveFailure?
    private(set) var isSaving = false

    init(category: LedgerCategory? = nil, kind: EntryKind = .expense, makeID: () -> String = OrganizeID.make) {
        original = category
        id = category?.id ?? makeID()
        name = category?.name ?? ""
        self.kind = category?.kind ?? kind
        color = category?.color ?? CategoryStyle.hex(CategoryStyle.pickerColors[0])
        icon = category?.icon ?? "pricetag-outline"
    }

    var isNew: Bool { original == nil }
    var title: String { isNew ? "New category" : "Edit category" }
    var draft: LedgerCategory { LedgerCategory(id: id, name: name, icon: icon, color: color, kind: kind) }
    var canSave: Bool { !isSaving && !draft.trimmed().name.isEmpty }
    var paletteColor: CategoryColor { CategoryStyle.color(forCategoryID: id, hex: color) }

    func choose(_ color: CategoryColor) { self.color = CategoryStyle.hex(color) }

    /// A new category, or one nothing uses, can change kind.
    func canChangeKind(in ledger: Ledger) -> Bool { isNew || !ledger.usage(ofCategory: id).isInUse }

    func save(with commit: LedgerCommit) async -> LedgerCategory? {
        guard !isSaving else { return nil }
        isSaving = true
        defer { isSaving = false }
        let category = draft.trimmed()
        let summary = ChangeSummary(title: isNew ? "Category added" : "Category updated", detail: category.name)
        failure = await commit(.saveCategory(category, original: original), summary)
        return failure == nil ? category : nil
    }

    func remove(with commit: LedgerCommit) async -> Bool {
        guard let original, !isSaving else { return false }
        isSaving = true
        defer { isSaving = false }
        failure = await commit(
            .saveCategory(original, original: original, remove: true),
            ChangeSummary(title: "Category removed", detail: original.name))
        return failure == nil
    }

    static func removalNote(name: String, usage: RecordUsage) -> String? {
        guard usage.isInUse else { return nil }
        return "\(name) is used by \(OrganizeText.uses(usage)). Keep it to preserve your history."
    }
}

// MARK: Schedules

/// The schedule form (`edit-schedule`, and a new schedule from Recurring). Editing changes the
/// rule only: entries it already recorded keep their own values, and moving the next date
/// re-anchors it (`EntryDraft.buildSchedule`). A new schedule records its first date as an
/// entry and starts the rule after it, like a repeating entry from Add entry.
@MainActor
@Observable
final class ScheduleFormModel {
    let original: RecurringRule?
    var draft: EntryDraft
    private(set) var failure: SaveFailure?
    private(set) var isSaving = false
    @ObservationIgnored private let entryID: String
    @ObservationIgnored private let ruleID: String

    init(rule: RecurringRule) {
        original = rule
        draft = EntryDraft(schedule: rule)
        entryID = rule.id
        ruleID = rule.id
    }

    init(today: CalendarDate, categories: [LedgerCategory], makeID: () -> String = OrganizeID.make) {
        original = nil
        draft = .newSchedule(today: today, categories: categories)
        entryID = makeID()
        ruleID = makeID()
    }

    var isNew: Bool { original == nil }
    var title: String { isNew ? "New schedule" : "Edit schedule" }

    /// The draft's date as a day, or nil while it isn't one.
    var date: CalendarDate? {
        get { CalendarDate.ledgerDate(draft.date) }
        set { if let newValue { draft.date = newValue.description } }
    }

    func setKind(_ kind: EntryKind, categories: [LedgerCategory]) {
        draft.switchKind(to: kind, categories: categories)
    }

    /// An account created inline from this form: select it, keep everything else.
    func accountCreated(_ account: PaymentAccount) { draft.accountId = account.id }

    /// A category created inline: select it when it fits the draft's kind.
    func categoryCreated(_ category: LedgerCategory) {
        if category.kind == draft.kind { draft.categoryId = category.id }
    }

    /// Validates and saves. Returns the saved rule, or nil with `failure` set and the draft kept.
    func save(categories: [LedgerCategory], with commit: LedgerCommit) async -> RecurringRule? {
        guard !isSaving else { return nil }
        isSaving = true
        defer { isSaving = false }
        let change: LedgerChange
        let rule: RecurringRule
        do throws(LedgerRuleError) {
            if let original {
                rule = try draft.buildSchedule(categories: categories, original: original)
                change = .saveSchedule(rule, original: original)
            } else {
                var ids = [entryID, ruleID].makeIterator()
                let built = try draft.build(categories: categories, makeID: { ids.next() ?? OrganizeID.make() })
                guard let started = built.rule else { throw .chooseRepeat }
                rule = started
                change = .saveEntry(built.entry, rule: started)
            }
        } catch {
            failure = .rule(error)
            return nil
        }
        let summary = ChangeSummary(
            title: isNew ? "Schedule added" : "Schedule updated", detail: rule.title, kind: rule.kind,
            categoryId: rule.categoryId)
        failure = await commit(change, summary)
        return failure == nil ? rule : nil
    }
}

/// Pause, resume and remove, from a row's swipe actions or the schedule's page.
enum ScheduleActions {
    /// Pauses an active schedule or resumes a paused one. Resuming skips every date up to
    /// `today`: a pause never records the dates it covered.
    static func toggle(_ rule: RecurringRule, today: CalendarDate) -> (LedgerChange, ChangeSummary) {
        (
            .setScheduleActive(id: rule.id, active: !rule.active, today: today),
            ChangeSummary(title: rule.active ? "Schedule paused" : "Schedule resumed", detail: rule.title)
        )
    }

    /// Removes the schedule. Entries it already recorded stay in Activity.
    static func remove(_ rule: RecurringRule) -> (LedgerChange, ChangeSummary) {
        (.removeSchedule(id: rule.id), ChangeSummary(title: "Schedule removed", detail: rule.title))
    }

    static let removalMessage = "Future entries stop. Entries already recorded stay in your activity."
}

// MARK: Text

enum OrganizeText {
    static func kind(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "Expense"
        case .income: "Income"
        case .investment: "Investment"
        }
    }

    static func kindPlural(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "Expenses"
        case .income: "Income"
        case .investment: "Investments"
        }
    }

    /// The legacy `accountTypeLabels`.
    static func accountType(_ type: AccountType) -> String {
        switch type {
        case .bank: "Bank account"
        case .credit: "Credit card"
        case .cash: "Cash"
        case .other: "Other"
        }
    }

    static func accountSymbol(_ type: AccountType) -> String {
        switch type {
        case .bank: "building.columns"
        case .credit: "creditcard"
        case .cash: "banknote"
        case .other: "ellipsis"
        }
    }

    static func count(_ value: Int, _ singular: String, _ plural: String) -> String {
        value == 1 ? "1 \(singular)" : "\(value) \(plural)"
    }

    /// "31 entries and 3 schedules", "1 entry", "2 schedules".
    static func uses(_ usage: RecordUsage) -> String {
        var parts: [String] = []
        if usage.entries > 0 { parts.append(count(usage.entries, "entry", "entries")) }
        if usage.schedules > 0 { parts.append(count(usage.schedules, "schedule", "schedules")) }
        return parts.joined(separator: " and ")
    }

    /// An account row's detail: "Credit card · 31 entries, 3 schedules" or "· not used yet".
    /// Never a balance: Penny doesn't connect to banks.
    static func accountDetail(_ account: PaymentAccount, usage: RecordUsage) -> String {
        var parts: [String] = []
        if usage.entries > 0 { parts.append(count(usage.entries, "entry", "entries")) }
        if usage.schedules > 0 { parts.append(count(usage.schedules, "schedule", "schedules")) }
        let use = parts.isEmpty ? "not used yet" : parts.joined(separator: ", ")
        return "\(accountType(account.type)) · \(use)"
    }

    static func categoryDetail(_ usage: RecordUsage) -> String {
        guard usage.isInUse else { return "Not used yet" }
        var text = count(usage.entries, "entry", "entries")
        if usage.schedules > 0 { text += ", " + count(usage.schedules, "schedule", "schedules") }
        return text
    }
}

/// Schedule wording for rows and the schedule page.
enum ScheduleText {
    static func frequency(_ frequency: RecurrenceFrequency) -> String {
        switch frequency {
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }

    /// "Every month on the 18th". A rule anchored after the 28th says what happens in shorter
    /// months; weekly rules name the weekday and yearly rules the date.
    static func cadence(_ rule: RecurringRule) -> String {
        switch rule.frequency {
        case .weekly:
            return "Every week on \(weekday(rule.nextDate))"
        case .monthly:
            let day = "Every month on the \(ordinal(rule.anchorDay))"
            return rule.anchorDay > 28 ? "\(day), or the last day of shorter months" : day
        case .yearly:
            let day = "Every year on \(monthName(rule.nextDate.month)) \(rule.anchorDay)"
            return rule.anchorDay > 28 ? "\(day), or the month's last day" : day
        }
    }

    /// A row's detail: "Monthly · next Nov 15 · Visa", or "Paused · monthly · Visa".
    static func row(_ rule: RecurringRule, account: PaymentAccount?, today: CalendarDate) -> String {
        var parts =
            rule.active
            ? [frequency(rule.frequency), "next \(DayText.short(rule.nextDate, today: today))"]
            : ["Paused", frequency(rule.frequency).lowercased()]
        if let account { parts.append(account.name) }
        return parts.joined(separator: " · ")
    }

    /// "Today", "Tomorrow", "in 9 days".
    static func relative(_ date: CalendarDate, today: CalendarDate) -> String {
        switch date.days(since: today) {
        case 0: "Today"
        case 1: "Tomorrow"
        case let days where days > 1: "in \(days) days"
        default: "Past"
        }
    }

    static func meaning(_ rule: RecurringRule) -> MoneyMeaning {
        guard rule.active else { return .neutral }
        switch rule.kind {
        case .expense: return .expense
        case .income: return .income
        case .investment: return .investment
        }
    }

    static func ordinal(_ day: Int) -> String {
        let suffix =
            switch (day % 10, day % 100) {
            case (_, 11...13): "th"
            case (1, _): "st"
            case (2, _): "nd"
            case (3, _): "rd"
            default: "th"
            }
        return "\(day)\(suffix)"
    }

    static func monthName(_ month: Int) -> String {
        let names = [
            "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
            "November", "December",
        ]
        return names[(month - 1 + 12) % 12]
    }

    static func weekday(_ date: CalendarDate) -> String {
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][date.mondayBasedWeekday]
    }
}

extension LedgerCategory {
    /// The palette color this category is drawn with (`CategoryStyle.color(forCategoryID:hex:)`).
    var paletteColor: CategoryColor { CategoryStyle.color(forCategoryID: id, hex: color) }
}
