/// The entry form's rules as a value (MAZ-73): the draft, what it was opened with, and where
/// a save stands. The screen keeps one of these, so the draft survives nested pickers, inline
/// account and category creation and failed saves, and every rule here is tested without a
/// view.
///
/// - A save starts at most once at a time (`beginSave`), so a double tap or a second Save
///   while the first is running never records the entry twice. After a successful save the
///   editor is done and refuses further saves.
/// - A refused draft stays as typed; `failure` names the reason.
/// - Editing keeps the entry as the form opened it (`original`). A save or delete against an
///   entry that changed on another device since is refused by `LedgerChange` (stale check);
///   `reviewLatest(_:)` reopens the form on the latest version.
public struct EntryEditor: Hashable, Sendable {
    public enum Mode: Hashable, Sendable {
        case new
        case edit(LedgerEntry)
    }

    public enum Phase: Hashable, Sendable {
        case editing
        /// A save is running; its attempt number.
        case saving(Int)
        case saved
        /// The last save was refused or failed; the draft is unchanged.
        case failed(EntrySaveFailure)
    }

    public private(set) var mode: Mode
    public var draft: EntryDraft {
        didSet { categoryByKind[draft.kind] = draft.categoryId }
    }
    /// The draft as the form opened it, to tell whether there is anything to lose.
    public private(set) var initial: EntryDraft
    public private(set) var phase: Phase = .editing
    private var attempts = 0
    /// The category last chosen for each kind, so switching Expense → Income → Expense keeps it.
    private var categoryByKind: [EntryKind: String] = [:]

    /// A new entry of `kind` dated `today`, on the category used most for that kind.
    public init(new kind: EntryKind = .expense, today: CalendarDate, ledger: Ledger) {
        mode = .new
        let draft = EntryDraft(
            kind: kind, title: "", amount: "", date: today.description,
            categoryId: Self.defaultCategory(kind, in: ledger) ?? "")
        self.draft = draft
        initial = draft
        categoryByKind[kind] = draft.categoryId
    }

    /// Opens a new expense on a trip (Trip expense, MAZ-76): the trip is part of how the form
    /// opened, so closing it untouched asks nothing. Only a fresh new entry takes it; an edit, a
    /// kept draft the person already typed into (it could be an income or a transfer, and isn't
    /// turned into a trip expense), or a trip that isn't in the ledger is left alone (`saveEntry`
    /// would refuse it).
    public mutating func start(onTrip tripId: String, ledger: Ledger) {
        guard isNew, !isDirty, ledger.trip(id: tripId) != nil else { return }
        if draft.kind != .expense { setKind(.expense, ledger: ledger) }
        draft.tripId = tripId
        initial.tripId = tripId
        initial.kind = draft.kind
        initial.categoryId = draft.categoryId
    }

    /// Editing a recorded entry.
    public init(editing entry: LedgerEntry) {
        mode = .edit(entry)
        let draft = EntryDraft(editing: entry)
        self.draft = draft
        initial = draft
        categoryByKind[entry.kind] = entry.categoryId
    }

    public var original: LedgerEntry? {
        if case .edit(let entry) = mode { return entry }
        return nil
    }

    public var isNew: Bool { original == nil }
    public var isDirty: Bool { draft != initial }
    public var isSaving: Bool {
        if case .saving = phase { return true }
        return false
    }
    public var isSaved: Bool { phase == .saved }
    public var failure: EntrySaveFailure? {
        if case .failed(let failure) = phase { return failure }
        return nil
    }

    /// Whether the failure means the entry changed or was removed on another device, so the
    /// next step is to review the latest version rather than to try again.
    public var hasConflict: Bool {
        switch failure?.rule {
        case .entryChangedOnAnotherDevice?, .entryChangedBeforeDelete?: true
        default: false
        }
    }

    /// Switches the kind. The category follows: the one last chosen for that kind, else the
    /// most used one. Income and investments have no split, trip or receipt; the draft keeps
    /// them so switching back restores them, and `EntryDraft.build` drops them.
    public mutating func setKind(_ kind: EntryKind, ledger: Ledger) {
        guard kind != draft.kind else { return }
        let remembered = categoryByKind[kind].flatMap { id in ledger.category(id: id).map { _ in id } }
        draft.kind = kind
        draft.categoryId = remembered ?? Self.defaultCategory(kind, in: ledger) ?? ""
    }

    /// Starts a save: validates the draft and builds the change. Returns `.alreadySaving` while
    /// a save runs or after one succeeded, so a repeated tap does nothing.
    public mutating func beginSave(in ledger: Ledger, makeID: () -> String) -> EntrySaveStart {
        if isSaving || isSaved { return .alreadySaving }
        do throws(LedgerRuleError) {
            let (entry, rule) = try draft.build(categories: ledger.categories, editing: original, makeID: makeID)
            attempts += 1
            phase = .saving(attempts)
            return .ready(
                EntrySaveAttempt(
                    number: attempts, entry: entry, rule: rule,
                    change: .saveEntry(entry, original: original, rule: rule)))
        } catch {
            phase = .failed(EntrySaveFailure(rule: error))
            return .invalid(error)
        }
    }

    /// Records how attempt `number` ended. An answer for an older attempt is ignored.
    public mutating func finish(_ number: Int, failure: EntrySaveFailure?) {
        guard phase == .saving(number) else { return }
        phase = failure.map { .failed($0) } ?? .saved
    }

    /// A draft read back from storage (`EntryDraftShelf`): `draft` as kept, on `mode`. A new
    /// entry's form counts as untouched with only its kind, date and category set.
    public init(restoring draft: EntryDraft, mode: Mode) {
        self.mode = mode
        switch mode {
        case .new:
            initial = EntryDraft(
                kind: draft.kind, title: "", amount: "", date: draft.date, categoryId: draft.categoryId)
        case .edit(let entry):
            initial = EntryDraft(editing: entry)
        }
        self.draft = draft
        categoryByKind[draft.kind] = draft.categoryId
    }

    /// This editor as a draft to come back to: a save still running counts as not started,
    /// so if it fails the restored form can save again. A finished save stays finished.
    public var resumable: EntryEditor {
        guard isSaving else { return self }
        var copy = self
        copy.phase = .editing
        return copy
    }

    /// Reopens the form on `latest`, the entry as the ledger holds it now, after a conflict.
    /// Returns false when the entry no longer exists (deleted on another device): the form
    /// should close. The person's edits are dropped: they asked to review the latest version.
    public mutating func reviewLatest(_ latest: LedgerEntry?) -> Bool {
        guard let latest else { return false }
        self = EntryEditor(editing: latest)
        return true
    }

    /// The category a new draft of `kind` starts on: the most used one, else the first.
    public static func defaultCategory(_ kind: EntryKind, in ledger: Ledger) -> String? {
        ledger.categoriesByUse(kind).first?.id
    }
}

/// Why a save did not go through. `rule` is set when a ledger rule refused it.
public struct EntrySaveFailure: Hashable, Sendable {
    public var message: String
    public var rule: LedgerRuleError?

    public init(message: String, rule: LedgerRuleError? = nil) {
        self.message = message
        self.rule = rule
    }

    public init(rule: LedgerRuleError) {
        self.init(message: rule.message, rule: rule)
    }
}

public enum EntrySaveStart: Sendable {
    /// A save is running or already succeeded: ignore the tap.
    case alreadySaving
    /// The draft was refused before saving; the editor shows why.
    case invalid(LedgerRuleError)
    case ready(EntrySaveAttempt)
}

/// One save: the change to commit and what it records.
public struct EntrySaveAttempt: Sendable {
    public let number: Int
    public let entry: LedgerEntry
    public let rule: RecurringRule?
    public let change: LedgerChange
}

extension EntryDraft {
    /// The form for a recorded entry. A split entry opens as "your share is this amount",
    /// because a personal entry stores only the two amounts, not how they
    /// were split. The repeat choice is not offered when editing an entry.
    public init(editing entry: LedgerEntry) {
        let split = entry.share != entry.total
        self.init(
            kind: entry.kind, title: entry.title, amount: AmountInput.text(cents: entry.total),
            date: entry.date.description, categoryId: entry.categoryId, accountId: entry.accountId,
            tripId: entry.tripId, note: entry.note, split: split ? .amount : .full,
            shareInput: split ? AmountInput.text(cents: entry.share) : "", receipt: entry.receipt)
    }

    /// The share the draft would record now, or nil while the amount or split is incomplete.
    public var previewShare: Int64? {
        guard let total = try? Money.cents(amount) else { return nil }
        return try? Money.personalShare(total: total, mode: kind == .expense ? split : .full, input: shareInput)
    }
}

extension Ledger {
    /// Categories of `kind`, most used first: by how many of the latest `recent` entries and
    /// rules use them, ties and unused categories in the ledger's order. The entry form shows
    /// the first three as chips and Activity as filters; the picker shows all.
    public func categoriesByUse(_ kind: EntryKind, recent: Int = 500) -> [LedgerCategory] {
        var counts: [String: Int] = [:]
        for entry in transactions.suffix(recent) where entry.kind == kind { counts[entry.categoryId, default: 0] += 1 }
        for rule in recurring where rule.kind == kind { counts[rule.categoryId, default: 0] += 1 }
        return categories.enumerated()
            .filter { $0.element.kind == kind }
            .sorted { lhs, rhs in
                let left = counts[lhs.element.id] ?? 0
                let right = counts[rhs.element.id] ?? 0
                return left != right ? left > right : lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}

/// The amount keypad's rules: what each key does to the typed text. The text is what
/// `Money.cents` parses, with "." as the separator whatever the locale shows.
public enum AmountInput {
    public enum Key: Hashable, Sendable {
        case digit(Int)
        case separator
        case delete
    }

    /// Applies one key. Up to nine whole digits and two decimals; one separator; a leading
    /// zero is replaced by the next digit; a separator on an empty amount starts "0.". Keys
    /// that would break a rule do nothing.
    public static func apply(_ key: Key, to text: String) -> String {
        let parts = text.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let whole = parts.first.map(String.init) ?? ""
        let fraction = parts.count > 1 ? String(parts[1]) : nil
        switch key {
        case .delete:
            return String(text.dropLast())
        case .separator:
            guard fraction == nil else { return text }
            return (whole.isEmpty ? "0" : whole) + "."
        case .digit(let digit):
            guard (0...9).contains(digit) else { return text }
            if let fraction {
                return fraction.count < 2 ? text + String(digit) : text
            }
            if whole == "0" { return String(digit) }
            return whole.count < 9 ? text + String(digit) : text
        }
    }

    /// Cents as the form shows them for editing: "12.30", "0.05".
    public static func text(cents: Int64) -> String {
        let value = max(cents, 0)
        let fraction = value % 100
        return "\(value / 100).\(fraction < 10 ? "0" : "")\(fraction)"
    }
}
