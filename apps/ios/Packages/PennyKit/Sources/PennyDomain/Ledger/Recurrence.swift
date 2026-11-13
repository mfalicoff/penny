/// Personal recurrence: next occurrences, materializing and schedule previews.
///
/// Occurrence identity is `"{ruleId}:{YYYY-MM-DD}"` (the date the rule produced, not the
/// entry's current date), so an occurrence is recorded at most once per rule and date on any
/// device, and editing or deleting it never brings it back. Shared household recurrence is
/// server-owned (MAZ-59) and never runs here.
public enum Recurrence {
    /// The occurrence after `date`. Weekly adds seven days. Monthly and yearly move one or
    /// twelve calendar months and land on `anchorDay`, or on the month's last day when it is
    /// shorter, so a rule anchored on the 31st goes Jan 31 → Feb 28 (29 in leap years) → Mar 31.
    public static func next(
        after date: CalendarDate, frequency: RecurrenceFrequency, anchorDay: Int
    ) -> CalendarDate {
        switch frequency {
        case .weekly: date.adding(days: 7)
        case .monthly: date.addingMonths(1, day: anchorDay)
        case .yearly: date.addingMonths(12, day: anchorDay)
        }
    }

    /// The id of the entry a rule records for `date`.
    public static func occurrenceID(ruleID: String, date: CalendarDate) -> String { "\(ruleID):\(date)" }

    /// Records every due occurrence of every active rule, through `today` inclusive, and
    /// advances each rule's `nextDate` past `today`.
    ///
    /// Missed dates catch up once. An occurrence whose id already exists is skipped but still
    /// advances `nextDate`, so running this again (or on another device, after a merge) adds
    /// nothing. Paused rules are left untouched. `today` is the device's local calendar day.
    ///
    /// Known limitation: during 2100 an active rule's `nextDate` can advance past 2100-12-31,
    /// which `Ledger.violations` (and the server) then refuse. Materializing has no error path,
    /// so it is not refused here; only a new repeating draft is (`EntryDraft.build`).
    public static func materialize(_ ledger: Ledger, today: CalendarDate) -> Ledger {
        var result = ledger
        var existing = Set(ledger.transactions.map(\.id))
        result.recurring = ledger.recurring.map { rule in
            guard rule.active else { return rule }
            var rule = rule
            while rule.nextDate <= today {
                let id = occurrenceID(ruleID: rule.id, date: rule.nextDate)
                if existing.insert(id).inserted {
                    result.transactions.append(occurrence(of: rule, on: rule.nextDate))
                }
                rule.nextDate = next(after: rule.nextDate, frequency: rule.frequency, anchorDay: rule.anchorDay)
            }
            return rule
        }
        return result
    }

    /// The entries active rules would record from their `nextDate` through `end`, dated on or
    /// after `start`, minus any occurrence the ledger already holds. A preview: it never
    /// changes the ledger, so browsing a future month records nothing and advances nothing.
    public static func previews(
        _ ledger: Ledger, from start: CalendarDate, through end: CalendarDate
    ) -> [LedgerEntry] {
        let existing = Set(ledger.transactions.map(\.id))
        var result: [LedgerEntry] = []
        for rule in ledger.recurring where rule.active {
            var date = rule.nextDate
            while date <= end {
                if date >= start, !existing.contains(occurrenceID(ruleID: rule.id, date: date)) {
                    result.append(occurrence(of: rule, on: date))
                }
                date = next(after: date, frequency: rule.frequency, anchorDay: rule.anchorDay)
            }
        }
        return result
    }

    /// The entry a rule records on `date`. Rules carry no trip or receipt, so neither does
    /// the occurrence; a missing account stays missing.
    public static func occurrence(of rule: RecurringRule, on date: CalendarDate) -> LedgerEntry {
        LedgerEntry(
            id: occurrenceID(ruleID: rule.id, date: date), title: rule.title, kind: rule.kind, total: rule.total,
            share: rule.share, categoryId: rule.categoryId, accountId: rule.accountId, date: date, note: rule.note,
            recurringId: rule.id)
    }
}
