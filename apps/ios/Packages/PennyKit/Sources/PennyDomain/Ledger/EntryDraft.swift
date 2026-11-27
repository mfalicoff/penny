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
    /// The currency the amount is typed in (MAZ-151): nil for the ledger's home currency, else an
    /// ISO 4217 code of `Currencies.all`. `amount` (and an amount split) are in its minor units.
    public var currency: String?
    /// The rate for `currency` (home units per unit, canonical), nil until one is known or typed.
    public var rate: String?
    /// Where `rate` came from; a rate the person typed is `.edited`.
    public var rateStatus: RateStatus?
    /// The publication `rate` comes from (nil for an edited rate).
    public var rateDate: CalendarDate?

    public init(
        kind: EntryKind, title: String, amount: String, date: String, categoryId: String, accountId: String? = nil,
        tripId: String? = nil, note: String = "", split: Money.SplitMode = .full, shareInput: String = "",
        frequency: RecurrenceFrequency? = nil, receipt: ReceiptReference? = nil, currency: String? = nil,
        rate: String? = nil, rateStatus: RateStatus? = nil, rateDate: CalendarDate? = nil
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
        self.currency = currency
        self.rate = rate
        self.rateStatus = rateStatus
        self.rateDate = rateDate
    }

    /// The draft's currency when it isn't `home` (an entry in another currency), else nil.
    public func foreignCurrency(home: Currency) -> String? {
        guard let currency, currency != home.rawValue else { return nil }
        return currency
    }

    /// The decimal places the amount is typed with: the draft currency's, two for the home ones.
    public var minorUnits: Int { currency.flatMap(Currencies.info)?.minorUnits ?? 2 }

    /// The amounts of a draft in another currency (`Currencies.entryAmounts`): the original
    /// amount, the converted home total and the share. Nil for a home draft.
    public func foreignAmounts(home: Currency) throws(LedgerRuleError) -> EntryAmounts? {
        guard let code = foreignCurrency(home: home) else { return nil }
        guard Currencies.isCurrency(code) else { throw .unknownCurrency }
        return try Currencies.entryAmounts(
            amount: amount, currency: code, home: home.rawValue, rate: rate, mode: kind == .expense ? split : .full,
            split: shareInput)
    }

    /// Moves the draft to `code` (nil: the home currency). Digits beyond the new currency's minor
    /// units are dropped, as is an amount split typed in the old currency's units; the rate is
    /// cleared for the caller to look up again (an edited rate belongs to the old currency too).
    public mutating func setCurrency(_ code: String?, home: Currency) {
        let next = code == home.rawValue ? nil : code
        guard next != currency else { return }
        currency = next
        amount = AmountInput.fitting(amount, minorUnits: minorUnits)
        if split == .amount { shareInput = AmountInput.fitting(shareInput, minorUnits: minorUnits) }
        rate = nil
        rateStatus = nil
        rateDate = nil
    }

    /// Puts a looked-up or typed rate on the draft. A looked-up rate never replaces an edited one.
    public mutating func applyRate(_ choice: RateChoice) {
        if choice.status != .edited, rateStatus == .edited { return }
        rate = choice.rate
        rateStatus = choice.status
        rateDate = choice.status == .edited ? nil : choice.date
    }

    /// Builds the entry to save, and the rule it starts when the draft repeats.
    ///
    /// Checks run in this order: amount, non-zero amount, date, title, category, then
    /// the split. A new repeating draft whose next date would fall after 2100-12-31 is then
    /// refused with `.scheduleAfterLedgerRange` (the server would refuse it at sync). Title and
    /// note are trimmed. Only expenses keep a split, a trip and a receipt, and an equal split records its head count
    /// as `participants` (contract 2.2.0);
    /// income and investments are always the full amount. A new repeating draft also returns
    /// its rule: the entry is the first occurrence (it carries the rule's id as `recurringId`)
    /// and the rule's `nextDate` is the occurrence after it, anchored on the draft's day, so
    /// materializing never records the first date twice. When editing (`entry` set), the id
    /// and `recurringId` are kept and the repeat choice is ignored.
    ///
    /// - Parameter makeID: generates ids for a new entry and a new rule, in that order.
    ///
    /// A draft in another currency than `home` (MAZ-151) needs a rate (`.missingRate`); its total and
    /// share are converted with `Currencies.entryAmounts` and it never starts a rule (recurring rules
    /// stay in the home currency). Editing an entry whose amount, currency, rate and split are
    /// unchanged keeps its stored amounts exactly.
    public func build(
        categories: [LedgerCategory], editing entry: LedgerEntry? = nil, home: Currency = .cad, makeID: () -> String
    ) throws(LedgerRuleError) -> (entry: LedgerEntry, rule: RecurringRule?) {
        let foreign = foreignCurrency(home: home)
        var total: Int64
        var share: Int64
        var participants: Int?
        var original: EntryAmounts?
        if foreign != nil {
            // The amount first, as for a home draft, then the rate.
            _ = try Currencies.parseAmount(amount, currency: foreign ?? "")
            guard rate != nil else { throw .missingRate }
            guard let amounts = try foreignAmounts(home: home) else { throw .missingRate }
            original = amounts
            total = amounts.total
            share = amounts.share
        } else {
            total = try Money.cents(amount)
            guard total > 0 else { throw .zeroAmount }
            share = 0
        }
        guard let date = CalendarDate.ledgerDate(date) else { throw .invalidDate }
        let title = JavaScriptText.trim(title)
        guard !title.isEmpty else { throw .missingTitle }
        guard categories.contains(where: { $0.id == categoryId && $0.kind == kind }) else { throw .chooseCategory }
        if foreign == nil {
            share = try Money.personalShare(total: total, mode: kind == .expense ? split : .full, input: shareInput)
        }
        participants = try kind == .expense ? Money.splitParticipants(mode: split, input: shareInput) : nil
        if let entry, foreign != nil, keepsAmounts(of: entry, home: home) {
            total = entry.total
            share = entry.share
            participants = entry.participants
        }
        var result = LedgerEntry(
            id: entry?.id ?? makeID(), title: title, kind: kind, total: total, share: share, participants: participants,
            categoryId: categoryId,
            accountId: accountId, tripId: kind == .expense ? tripId : nil, date: date,
            note: JavaScriptText.trim(note), receipt: kind == .expense ? receipt : nil, recurringId: entry?.recurringId)
        if let foreign, let original, let rate {
            let status = rateStatus ?? .edited
            result.originalAmount = original.originalAmount
            result.originalCurrency = foreign
            result.rate = rate
            result.rateStatus = status
            result.rateDate = status == .edited ? nil : rateDate
            if let entry, keepsAmounts(of: entry, home: home) {
                result.originalAmount = entry.originalAmount
            }
        }
        guard entry == nil, foreign == nil, let frequency else { return (result, nil) }
        let nextDate = Recurrence.next(after: date, frequency: frequency, anchorDay: date.day)
        // The server stores dates through 2100-12-31 only; a rule past that could never sync.
        guard nextDate.isWithinLedgerRange else { throw .scheduleAfterLedgerRange }
        let rule = RecurringRule(
            id: makeID(), title: result.title, kind: kind, total: total, share: share, participants: participants,
            categoryId: categoryId,
            accountId: accountId, date: date, note: result.note, frequency: frequency, nextDate: nextDate,
            anchorDay: date.day)
        result.recurringId = rule.id
        return (result, rule)
    }

    /// Whether the amount, currency, rate and split are as `EntryDraft(editing: entry)` opened them,
    /// so an edit of other fields keeps the stored amounts (a split typed in another currency can't
    /// be shown exactly).
    func keepsAmounts(of entry: LedgerEntry, home: Currency) -> Bool {
        guard entry.isForeign, kind == entry.kind else { return false }
        let opened = EntryDraft(editing: entry)
        return amount == opened.amount && currency == opened.currency && rate == opened.rate
            && rateStatus == opened.rateStatus && rateDate == opened.rateDate && split == opened.split
            && shareInput == opened.shareInput
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
            participants: original.participants,
            categoryId: original.categoryId, accountId: original.accountId, date: original.nextDate,
            note: original.note)
        let (details, _) = try build(categories: categories, editing: asEntry, makeID: { original.id })
        var rule = original
        rule.title = details.title
        rule.kind = details.kind
        rule.total = details.total
        rule.share = details.share
        rule.participants = details.participants
        rule.categoryId = details.categoryId
        rule.accountId = details.accountId
        rule.note = details.note
        rule.frequency = frequency
        rule.nextDate = details.date
        rule.anchorDay = date == original.nextDate.description ? original.anchorDay : details.date.day
        return rule
    }
}
