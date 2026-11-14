/// How many records use a payment account or a category (MAZ-74). Accounts and categories
/// are labels, never balances: the Accounts and Categories pages show this count instead, and
/// the removal guards (`LedgerChange.saveAccount`/`saveCategory` with `remove`) refuse while
/// it is not zero, so no entry or schedule is left pointing at a removed record.
public struct RecordUsage: Hashable, Sendable {
    /// Recorded entries, generated occurrences included.
    public var entries: Int
    /// Schedules (recurring rules), active or paused.
    public var schedules: Int

    public init(entries: Int = 0, schedules: Int = 0) {
        self.entries = entries
        self.schedules = schedules
    }

    /// Whether removing the record would be refused.
    public var isInUse: Bool { entries > 0 || schedules > 0 }
}

extension Ledger {
    /// Entries and schedules labelled with the account `id`.
    public func usage(ofAccount id: String) -> RecordUsage {
        RecordUsage(
            entries: transactions.count { $0.accountId == id }, schedules: recurring.count { $0.accountId == id })
    }

    /// Entries and schedules in the category `id`.
    public func usage(ofCategory id: String) -> RecordUsage {
        RecordUsage(
            entries: transactions.count { $0.categoryId == id }, schedules: recurring.count { $0.categoryId == id })
    }
}

extension PaymentAccount {
    /// The account as `LedgerChange.saveAccount` stores it: the name trimmed with JavaScript's
    /// whitespace rules. A form returns this to its caller after a save.
    public func trimmed() -> PaymentAccount {
        var account = self
        account.name = JavaScriptText.trim(name)
        return account
    }
}

extension LedgerCategory {
    /// The category as `LedgerChange.saveCategory` stores it: the name trimmed.
    public func trimmed() -> LedgerCategory {
        var category = self
        category.name = JavaScriptText.trim(name)
        return category
    }
}

extension RecurringRule {
    /// The next `count` dates this rule would record, starting at `nextDate`, following the
    /// anchor day through short months (a rule on the 31st: Jan 31, Feb 28, Mar 31). Dates
    /// after the ledger range (2100-12-31) are left out. A paused rule still has these dates;
    /// resuming skips the ones already past (`LedgerChange.setScheduleActive`).
    public func upcomingDates(_ count: Int) -> [CalendarDate] {
        var result: [CalendarDate] = []
        var date = nextDate
        while result.count < count, date.isWithinLedgerRange {
            result.append(date)
            date = Recurrence.next(after: date, frequency: frequency, anchorDay: anchorDay)
        }
        return result
    }
}

extension EntryDraft {
    /// The schedule form's draft for editing `rule`:
    /// the amount as typed money, the next date as the date, and a share that differs from the
    /// total as an amount split. Build it back with `buildSchedule(categories:original:)`;
    /// an untouched draft rebuilds the same rule.
    public init(schedule rule: RecurringRule) {
        self.init(
            kind: rule.kind, title: rule.title, amount: Self.moneyText(rule.total), date: rule.nextDate.description,
            categoryId: rule.categoryId, accountId: rule.accountId, note: rule.note,
            split: rule.kind == .expense && rule.share != rule.total ? .amount : .full,
            shareInput: Self.moneyText(rule.share), frequency: rule.frequency)
    }

    /// A new schedule's draft: monthly from `today`, in the first category of `kind`.
    public static func newSchedule(
        kind: EntryKind = .expense, today: CalendarDate, categories: [LedgerCategory]
    ) -> EntryDraft {
        EntryDraft(
            kind: kind, title: "", amount: "", date: today.description,
            categoryId: categories.first { $0.kind == kind }?.id ?? "", frequency: .monthly)
    }

    /// Changes the kind and keeps the draft consistent: a category of another kind is replaced
    /// by the first category of the new kind, and only expenses keep a split.
    public mutating func switchKind(to kind: EntryKind, categories: [LedgerCategory]) {
        guard kind != self.kind else { return }
        self.kind = kind
        if !categories.contains(where: { $0.id == categoryId && $0.kind == kind }) {
            categoryId = categories.first { $0.kind == kind }?.id ?? ""
        }
        if kind != .expense { split = .full }
    }

    /// Cents as the form shows them ("1200.00"), which `Money.cents` reads back exactly.
    static func moneyText(_ cents: Int64) -> String {
        let fraction = cents % 100
        return "\(cents / 100).\(fraction < 10 ? "0" : "")\(fraction)"
    }
}
