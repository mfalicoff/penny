import Foundation

/// A personal entry that repeats, offered on Recurring as a schedule (MAZ-290).
///
/// Optional fields are nil exactly when the TypeScript suggestion omits them.
public struct RecurringSuggestion: Hashable, Sendable, Identifiable {
    /// `{kind}|{key}|{frequency}`.
    public var id: String
    public var kind: EntryKind
    /// The normalised title (`RecurringSuggestions.key`).
    public var key: String
    public var frequency: RecurrenceFrequency
    /// The newest entry's title, as typed.
    public var title: String
    public var total: Int64
    public var share: Int64
    public var participants: Int?
    /// The most common category of the matched entries (ties: the newest such entry's).
    public var categoryId: String
    /// The newest entry's account.
    public var accountId: String?
    /// The amount before a price step that held, for "was $15.49".
    public var previousShare: Int64?
    public var anchorDay: Int
    /// The first anchored date after both the latest matched entry and today.
    public var nextDate: CalendarDate
    public var count: Int
    public var firstDate: CalendarDate
    public var lastDate: CalendarDate
    /// The matched entries, newest first.
    public var entryIds: [String]

    public init(
        id: String, kind: EntryKind, key: String, frequency: RecurrenceFrequency, title: String, total: Int64,
        share: Int64, participants: Int? = nil, categoryId: String, accountId: String? = nil,
        previousShare: Int64? = nil, anchorDay: Int, nextDate: CalendarDate, count: Int, firstDate: CalendarDate,
        lastDate: CalendarDate, entryIds: [String]
    ) {
        self.id = id
        self.kind = kind
        self.key = key
        self.frequency = frequency
        self.title = title
        self.total = total
        self.share = share
        self.participants = participants
        self.categoryId = categoryId
        self.accountId = accountId
        self.previousShare = previousShare
        self.anchorDay = anchorDay
        self.nextDate = nextDate
        self.count = count
        self.firstDate = firstDate
        self.lastDate = lastDate
        self.entryIds = entryIds
    }

    /// `{id}|{share}`: what `Ledger.dismissedSuggestions` stores for a dismissal.
    public var dismissal: String { "\(id)|\(share)" }
}

/// Recurring suggestions: personal entries that repeat with the same name, a regular gap and a
/// steady amount (`apps/web/src/domain/suggestions.ts`, golden cases in
/// `contracts/fixtures/recurring-suggestions.json`). Detection runs on the device only.
///
/// 1. Group the personal ledger's own entries by kind and normalised title (`key`). Entries a
///    schedule recorded, entries dated after today, and a group an existing schedule covers (same
///    kind and key) are left out.
/// 2. The interval is the lower median gap between the sorted dates: weekly 6–8 days, monthly
///    27–33, yearly 358–372. At least 80% of the gaps fit it.
/// 3. At least 3 entries weekly or monthly, 2 yearly, the latest within 1.5 intervals of today.
/// 4. The amount is steady: the newest entries, from a single price step on, are each within 10%
///    or $2 of the median of the last 3, and the entries before the step agree with their own
///    median the same way. After a step that held, `previousShare` is the amount before it.
/// 5. The anchor day is the most common day of the month (ties: the larger day); weekly, the next
///    date's day. The next date is the first anchored date after both the latest entry and today.
///
/// A dismissal (`{id}|{share}`) hides the suggestion while its newest amount stays within 25% of
/// the dismissed one. Pure: `today` is passed in.
public enum RecurringSuggestions {
    public static let maxDismissed = 500
    public static let maxDismissalLength = 200

    private static let stopWords: Set<String> = [
        "inc", "ltd", "llc", "corp", "co", "com", "subscription", "subscriptions", "payment", "payments",
        "autopay", "bill", "monthly", "weekly", "yearly", "annual", "renewal", "membership",
    ]

    /// Lower case, diacritics removed (NFD, then every Unicode mark dropped), every run of
    /// non-letters a word break, and the stop words dropped.
    public static func key(_ title: String) -> String {
        var unmarked = String.UnicodeScalarView()
        for scalar in title.decomposedStringWithCanonicalMapping.unicodeScalars where !isMark(scalar) {
            unmarked.append(scalar)
        }
        let lowered = JavaScriptText.lowercase(String(unmarked))
        var words: [String] = []
        var word = String.UnicodeScalarView()
        func flush() {
            if !word.isEmpty {
                let text = String(word)
                if !stopWords.contains(text) { words.append(text) }
                word = String.UnicodeScalarView()
            }
        }
        for scalar in lowered.unicodeScalars {
            if isLetter(scalar) { word.append(scalar) } else { flush() }
        }
        flush()
        return words.joined(separator: " ")
    }

    private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: true
        default: false
        }
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: true
        default: false
        }
    }

    private static func nominal(_ frequency: RecurrenceFrequency) -> Int {
        switch frequency {
        case .weekly: 7
        case .monthly: 30
        case .yearly: 365
        }
    }

    private static func minimumCount(_ frequency: RecurrenceFrequency) -> Int {
        frequency == .yearly ? 2 : 3
    }

    /// The lower median of a non-empty list.
    private static func median<Value: Comparable>(_ values: some Collection<Value>) -> Value {
        let sorted = values.sorted()
        return sorted[(sorted.count - 1) / 2]
    }

    private static func frequency(ofGap gap: Int) -> RecurrenceFrequency? {
        switch gap {
        case 6...8: .weekly
        case 27...33: .monthly
        case 358...372: .yearly
        default: nil
        }
    }

    private static func near(_ amount: Int64, _ reference: Int64) -> Bool {
        let difference = abs(amount - reference)
        return difference <= 200 || difference * 10 <= reference
    }

    /// Whether a stored dismissal hides `suggestion`: same id, and the amount moved by at most 25%.
    public static func isDismissed(_ suggestion: RecurringSuggestion, by dismissed: [String]) -> Bool {
        let prefix = Array("\(suggestion.id)|".utf16)
        return dismissed.contains { item in
            let units = Array(item.utf16)
            guard units.count > prefix.count, units[..<prefix.count].elementsEqual(prefix) else { return false }
            let rest = units[prefix.count...]
            // `/^\d{1,11}$/`: ASCII digits only.
            guard rest.count <= 11, rest.allSatisfy({ (0x30...0x39).contains($0) }) else { return false }
            let amount = rest.reduce(Int64(0)) { $0 * 10 + Int64($1 - 0x30) }
            return abs(suggestion.share - amount) * 4 <= amount
        }
    }

    /// One group's suggestion, or nil. `entries` share a kind and key, sorted by date then id.
    private static func suggest(
        kind: EntryKind, key: String, entries: [LedgerEntry], today: CalendarDate
    ) -> RecurringSuggestion? {
        guard entries.count >= 2, let first = entries.first, let latest = entries.last else { return nil }
        let days = entries.map(\.date.epochDay)
        let gaps = zip(days.dropFirst(), days).map { $0 - $1 }
        guard let frequency = frequency(ofGap: median(gaps)) else { return nil }
        let fits = gaps.filter { self.frequency(ofGap: $0) == frequency }.count
        guard fits * 5 >= gaps.count * 4, entries.count >= minimumCount(frequency) else { return nil }
        guard (today.epochDay - latest.date.epochDay) * 2 <= nominal(frequency) * 3 else { return nil }

        let amounts = entries.map(\.share)
        let reference = median(amounts.suffix(3))
        var step = amounts.count
        while step > 0, near(amounts[step - 1], reference) { step -= 1 }
        guard step != amounts.count else { return nil }
        if step > 0 {
            guard amounts.count - step >= 2 else { return nil }
            let before = amounts[..<step]
            let previous = median(before)
            guard before.allSatisfy({ near($0, previous) }) else { return nil }
        }
        let share = latest.share
        var previousShare: Int64?
        if amounts.count >= 3, amounts[amounts.count - 2] == share {
            previousShare = amounts[..<(amounts.count - 2)].last { $0 != share }
        }

        var dayCounts: [Int: Int] = [:]
        for entry in entries { dayCounts[entry.date.day, default: 0] += 1 }
        var anchorDay = 0
        var anchorCount = 0
        for (day, count) in dayCounts where count > anchorCount || (count == anchorCount && day > anchorDay) {
            anchorDay = day
            anchorCount = count
        }

        var categoryCounts: [String: Int] = [:]
        for entry in entries { categoryCounts[entry.categoryId, default: 0] += 1 }
        let most = categoryCounts.values.max() ?? 0
        let categoryId = entries.last { categoryCounts[$0.categoryId] == most }?.categoryId ?? latest.categoryId

        let after = max(latest.date, today)
        var nextDate = latest.date
        while nextDate <= after {
            nextDate = Recurrence.next(after: nextDate, frequency: frequency, anchorDay: anchorDay)
        }
        // Weekly dates ignore the anchor; store the next date's day, as the schedule form does.
        if frequency == .weekly { anchorDay = nextDate.day }

        return RecurringSuggestion(
            id: "\(kind.rawValue)|\(key)|\(frequency.rawValue)", kind: kind, key: key, frequency: frequency,
            title: latest.title, total: latest.total, share: share, participants: latest.participants,
            categoryId: categoryId, accountId: latest.accountId, previousShare: previousShare, anchorDay: anchorDay,
            nextDate: nextDate, count: entries.count, firstDate: first.date, lastDate: latest.date,
            entryIds: entries.reversed().map(\.id))
    }

    /// Every suggestion the ledger has today, dismissed ones left out: the longest-running first
    /// (earliest first entry), then by id.
    public static func suggestions(_ ledger: Ledger, today: CalendarDate) -> [RecurringSuggestion] {
        let covered = Set(ledger.recurring.map { "\($0.kind.rawValue)|\(key($0.title))" })
        var order: [String] = []
        var groups: [String: (kind: EntryKind, key: String, entries: [LedgerEntry])] = [:]
        for entry in ledger.transactions {
            if entry.recurringId != nil || entry.date > today { continue }
            let key = key(entry.title)
            if key.isEmpty { continue }
            let group = "\(entry.kind.rawValue)|\(key)"
            if covered.contains(group) { continue }
            if groups[group] == nil {
                order.append(group)
                groups[group] = (entry.kind, key, [])
            }
            groups[group]?.entries.append(entry)
        }
        let dismissed = ledger.dismissedSuggestions ?? []
        var result: [RecurringSuggestion] = []
        for name in order {
            guard let group = groups[name] else { continue }
            let entries = group.entries.sorted {
                $0.date != $1.date ? $0.date < $1.date : JavaScriptText.ordinalLess($0.id, $1.id)
            }
            if let suggestion = suggest(kind: group.kind, key: group.key, entries: entries, today: today),
                !isDismissed(suggestion, by: dismissed)
            {
                result.append(suggestion)
            }
        }
        return result.sorted {
            $0.firstDate != $1.firstDate ? $0.firstDate < $1.firstDate : JavaScriptText.ordinalLess($0.id, $1.id)
        }
    }

    /// The schedule accepting `suggestion` saves (the form opens with it filled in). Past entries
    /// aren't linked.
    public static func rule(for suggestion: RecurringSuggestion, id: String) -> RecurringRule {
        RecurringRule(
            id: id, title: suggestion.title, kind: suggestion.kind, total: suggestion.total, share: suggestion.share,
            participants: suggestion.participants, categoryId: suggestion.categoryId,
            accountId: suggestion.accountId, date: suggestion.nextDate, note: "", frequency: suggestion.frequency,
            nextDate: suggestion.nextDate, anchorDay: suggestion.anchorDay, active: true)
    }

    /// Appends `dismissal`, keeping the newest 500 (the ledger's limit).
    public static func adding(_ dismissal: String, to dismissed: [String]) -> [String] {
        var next = dismissed.filter { !same($0, dismissal) }
        next.append(dismissal)
        return Array(next.suffix(maxDismissed))
    }

    /// Three-way merge of `dismissedSuggestions`: a set union of both sides, except what this
    /// device removed (an Undo) since the base. The server's order first, then this device's
    /// additions; the newest 500 stay. Nil when no side has any.
    public static func mergeDismissals(base: [String]?, local: [String]?, remote: [String]?) -> [String]? {
        if base == nil, local == nil, remote == nil { return nil }
        // Compared as UTF-16 code units, like a JavaScript `Set` of strings.
        let mine = Set((local ?? []).map { Array($0.utf16) })
        let undone = Set((base ?? []).map { Array($0.utf16) }.filter { !mine.contains($0) })
        var seen = Set<[UInt16]>()
        var merged: [String] = []
        for item in (remote ?? []) + (local ?? []) {
            let units = Array(item.utf16)
            if undone.contains(units) || !seen.insert(units).inserted { continue }
            merged.append(item)
        }
        return Array(merged.suffix(maxDismissed))
    }

    static func same(_ lhs: String, _ rhs: String) -> Bool { lhs.utf16.elementsEqual(rhs.utf16) }
}
