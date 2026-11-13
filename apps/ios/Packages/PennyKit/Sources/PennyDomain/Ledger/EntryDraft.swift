/// What the entry form holds: raw text as typed plus the choices made. Building it validates
/// everything before any upload or save (`buildEntry` / `buildSchedule`), so a refused
/// draft keeps the person's input and the form shows `LedgerRuleError.message`.
public struct EntryDraft: Hashable, Sendable {
    public var kind: EntryKind
    public var title: String
    /// The receipt total as typed ("12.30" or "12,30").
    public var amount: String
    /// `YYYY-MM-DD`.
    public var date: String
    public var categoryId: String
    public var accountId: String?
    public var tripId: String?
    public var note: String
    public var split: Money.SplitMode
    /// Head count, amount or percentage for `split`.
    public var shareInput: String
    /// nil means "Does not repeat".
    public var frequency: RecurrenceFrequency?
    public var receipt: ReceiptReference?

    public init(
        kind: EntryKind, title: String, amount: String, date: String, categoryId: String, accountId: String? = nil,
        tripId: String? = nil, note: String = "", split: Money.SplitMode = .full, shareInput: String = "",
        frequency: RecurrenceFrequency? = nil, receipt: ReceiptReference? = nil
    ) {
        self.kind = kind
        self.title = title
        self.amount = amount
        self.date = date
        self.categoryId = categoryId
        self.accountId = accountId
        self.tripId = tripId
        self.note = note
        self.split = split
        self.shareInput = shareInput
        self.frequency = frequency
        self.receipt = receipt
    }

    /// Builds the entry to save, and the rule it starts when the draft repeats.
    ///
    /// Checks run in this order: amount, non-zero amount, date, title, category, then
    /// the split. A new repeating draft whose next date would fall after 2100-12-31 is then
    /// refused with `.scheduleAfterLedgerRange` (the server would refuse it at sync). Title and
    /// note are trimmed. Only expenses keep a split, a trip and a receipt;
    /// income and investments are always the full amount. A new repeating draft also returns
    /// its rule: the entry is the first occurrence (it carries the rule's id as `recurringId`)
    /// and the rule's `nextDate` is the occurrence after it, anchored on the draft's day, so
    /// materializing never records the first date twice. When editing (`entry` set), the id
    /// and `recurringId` are kept and the repeat choice is ignored.
    ///
    /// - Parameter makeID: generates ids for a new entry and a new rule, in that order.
    public func build(
        categories: [LedgerCategory], editing entry: LedgerEntry? = nil, makeID: () -> String
    ) throws(LedgerRuleError) -> (entry: LedgerEntry, rule: RecurringRule?) {
        let total = try Money.cents(amount)
        guard total > 0 else { throw .zeroAmount }
        guard let date = CalendarDate.ledgerDate(date) else { throw .invalidDate }
        let title = JavaScriptText.trim(title)
        guard !title.isEmpty else { throw .missingTitle }
        guard categories.contains(where: { $0.id == categoryId && $0.kind == kind }) else { throw .chooseCategory }
        let share = try Money.personalShare(total: total, mode: kind == .expense ? split : .full, input: shareInput)
        var result = LedgerEntry(
            id: entry?.id ?? makeID(), title: title, kind: kind, total: total, share: share, categoryId: categoryId,
            accountId: accountId, tripId: kind == .expense ? tripId : nil, date: date,
            note: JavaScriptText.trim(note), receipt: kind == .expense ? receipt : nil, recurringId: entry?.recurringId)
        guard entry == nil, let frequency else { return (result, nil) }
        let nextDate = Recurrence.next(after: date, frequency: frequency, anchorDay: date.day)
        // The server stores dates through 2100-12-31 only; a rule past that could never sync.
        guard nextDate.isWithinLedgerRange else { throw .scheduleAfterLedgerRange }
        let rule = RecurringRule(
            id: makeID(), title: result.title, kind: kind, total: total, share: share, categoryId: categoryId,
            accountId: accountId, date: date, note: result.note, frequency: frequency, nextDate: nextDate,
            anchorDay: date.day)
        result.recurringId = rule.id
        return (result, rule)
    }

    /// Builds an edited rule. The form shows the rule's next date as the draft's date; the
    /// first-occurrence `date` never changes. Moving the next date re-anchors the rule on the
    /// new day; keeping it keeps the anchor (a rule on the 31st stays on the 31st after Feb 28).
    /// Clearing the account removes it from the rule. Recorded occurrences are not changed.
    public func buildSchedule(
        categories: [LedgerCategory], original: RecurringRule
    ) throws(LedgerRuleError) -> RecurringRule {
        guard let frequency else { throw .chooseRepeat }
        let asEntry = LedgerEntry(
            id: original.id, title: original.title, kind: original.kind, total: original.total, share: original.share,
            categoryId: original.categoryId, accountId: original.accountId, date: original.nextDate,
            note: original.note)
        let (details, _) = try build(categories: categories, editing: asEntry, makeID: { original.id })
        var rule = original
        rule.title = details.title
        rule.kind = details.kind
        rule.total = details.total
        rule.share = details.share
        rule.categoryId = details.categoryId
        rule.accountId = details.accountId
        rule.note = details.note
        rule.frequency = frequency
        rule.nextDate = details.date
        rule.anchorDay = date == original.nextDate.description ? original.anchorDay : details.date.day
        return rule
    }
}
