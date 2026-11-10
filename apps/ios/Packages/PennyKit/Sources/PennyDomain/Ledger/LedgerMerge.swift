/// The three-way merge of unsynced local work onto a newer server ledger (legacy
/// `src/domain/merge.ts`; golden cases in `contracts/fixtures/merge-conflicts.json`).
///
/// `base` is the last ledger this device received from the server, `local` is `base` plus the
/// device's unsynced changes, and `remote` is the server's ledger now. Per list, by id:
///
/// - A record this device did not change follows the server: remote edits and deletes win.
/// - A record changed on both sides keeps every remote field this device did not edit, and
///   takes this device's value for every field it did edit. **Same-field races: the local
///   edit wins** (the device that syncs last decides), as in the legacy app.
/// - A record this device deleted is removed, even if the server edited it.
/// - A record this device edited that the server deleted comes back with the local version
///   (legacy behavior: the edit is newer than the delete it never saw).
/// - Records this device created are appended after the server's, in local order.
/// - Currency: a local change wins, otherwise the server's.
///
/// Three v2 refinements keep personal recurrence from duplicating, overwriting or resurrecting
/// occurrences when two devices both caught a rule up (docs/ios-offline-sync.md). An
/// occurrence is "untouched" when it equals what its rule generates for its date.
///
/// - When both sides advanced a rule's `nextDate`, the later one wins, so dates the server
///   already consumed are never recorded again.
/// - An occurrence both sides recorded takes the server's copy when this device's is
///   untouched, so an edit made on the other device is not overwritten by a regenerated copy.
/// - An occurrence this device recorded by itself (unchanged from what the rule generated)
///   is dropped when the server's rule is already past its date and the server does not have
///   it: another device recorded it and then deleted it.
///
/// The merge is pure. Callers materialize recurrence on the result (`Recurrence.materialize`).
public enum LedgerMerge {
    public static func merge(base: Ledger, local: Ledger, remote: Ledger) -> Ledger {
        var result = remote
        result.currency = local.currency != base.currency ? local.currency : remote.currency
        result.accounts = items(base.accounts, local.accounts, remote.accounts)
        result.trips = items(base.trips, local.trips, remote.trips)
        result.categories = items(base.categories, local.categories, remote.categories)
        result.recurring = keepConsumedDates(
            items(base.recurring, local.recurring, remote.recurring), base: base, local: local, remote: remote)
        // An occurrence both sides recorded is the same record: the server's copy (with any
        // edit made there) wins over this device's untouched one.
        let remoteEntries = Dictionary(remote.transactions.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let baseIDs = Set(base.transactions.map(\.id))
        let localEntries = local.transactions.map { entry in
            guard !baseIDs.contains(entry.id), let theirs = remoteEntries[entry.id],
                untouchedOccurrenceDate(entry, base: base, local: local) != nil
            else { return entry }
            return theirs
        }
        result.transactions = dropConsumedOccurrences(
            items(base.transactions, localEntries, remote.transactions), base: base, local: local, remote: remote)
        return result
    }

    /// The occurrence date when `entry` is exactly what its rule (as stored locally or in the
    /// base) generates for that date: recorded by this device, never edited.
    static func untouchedOccurrenceDate(_ entry: LedgerEntry, base: Ledger, local: Ledger) -> CalendarDate? {
        guard let ruleID = entry.recurringId, let date = occurrenceDate(entry.id, ruleID: ruleID) else { return nil }
        let generators = [local.rule(id: ruleID), base.rule(id: ruleID)].compactMap { $0 }
        return generators.contains { Recurrence.occurrence(of: $0, on: date) == entry } ? date : nil
    }

    /// The legacy `mergeItems`: remote order, minus local deletes, with local edits merged
    /// field by field, then local creations (and edits of remotely deleted records).
    static func items<Record: MergeableRecord>(_ base: [Record], _ local: [Record], _ remote: [Record]) -> [Record] {
        // Later duplicates win, as with a JavaScript `Map` built from the list.
        let before = Dictionary(base.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let localIDs = Set(local.map(\.id))
        var changed: [String: Record] = [:]
        for item in local where before[item.id] != item { changed[item.id] = item }
        let removed = Set(base.map(\.id).filter { !localIDs.contains($0) })
        let remoteIDs = Set(remote.map(\.id))
        var result = remote.filter { !removed.contains($0.id) }.map { item in
            guard let next = changed[item.id] else { return item }
            guard let original = before[item.id] else { return next }
            var merger = FieldMerger(merged: item, original: original, local: next)
            Record.mergeFields(&merger)
            return merger.merged
        }
        for item in local where !remoteIDs.contains(item.id) && changed[item.id] != nil { result.append(item) }
        return result
    }

    /// When both sides advanced a rule past the base `nextDate`, keep the later one.
    static func keepConsumedDates(_ merged: [RecurringRule], base: Ledger, local: Ledger, remote: Ledger)
        -> [RecurringRule]
    {
        merged.map { rule in
            guard let before = base.rule(id: rule.id), let mine = local.rule(id: rule.id),
                let theirs = remote.rule(id: rule.id), mine.nextDate > before.nextDate,
                theirs.nextDate > before.nextDate
            else { return rule }
            var rule = rule
            rule.nextDate = max(mine.nextDate, theirs.nextDate)
            return rule
        }
    }

    /// Drops occurrences this device recorded by itself that the server consumed and removed.
    static func dropConsumedOccurrences(_ merged: [LedgerEntry], base: Ledger, local: Ledger, remote: Ledger)
        -> [LedgerEntry]
    {
        let baseIDs = Set(base.transactions.map(\.id))
        let remoteIDs = Set(remote.transactions.map(\.id))
        return merged.filter { entry in
            guard !baseIDs.contains(entry.id), !remoteIDs.contains(entry.id), let ruleID = entry.recurringId,
                let date = untouchedOccurrenceDate(entry, base: base, local: local),
                let serverRule = remote.rule(id: ruleID)
            else { return true }
            return serverRule.nextDate <= date
        }
    }

    /// The date in an occurrence id `"{ruleId}:{YYYY-MM-DD}"`, or nil when `id` is not one.
    static func occurrenceDate(_ id: String, ruleID: String) -> CalendarDate? {
        let prefix = "\(ruleID):"
        guard id.hasPrefix(prefix) else { return nil }
        return CalendarDate(String(id.dropFirst(prefix.count)))
    }
}

/// What this device changed since its last synced ledger: the "N changes waiting" count
/// and the rows to mark "Waiting to sync".
public struct PendingChanges: Hashable, Sendable {
    /// Entries created or edited on this device and not yet acknowledged by the server.
    public var entryIDs: Set<String>
    /// Entries deleted on this device and not yet acknowledged.
    public var deletedEntryIDs: Set<String>
    /// Records created, edited or deleted in every list, plus one for a currency change.
    public var count: Int

    public static let none = PendingChanges(entryIDs: [], deletedEntryIDs: [], count: 0)

    public var isEmpty: Bool { count == 0 }

    public init(entryIDs: Set<String>, deletedEntryIDs: Set<String>, count: Int) {
        self.entryIDs = entryIDs
        self.deletedEntryIDs = deletedEntryIDs
        self.count = count
    }

    public init(base: Ledger, local: Ledger) {
        func diff<Record: MergeableRecord>(_ before: [Record], _ after: [Record]) -> (Set<String>, Set<String>) {
            let old = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            let new = Dictionary(after.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            let changed = Set(new.filter { old[$0.key] != $0.value }.keys)
            let removed = Set(old.keys.filter { new[$0] == nil })
            return (changed, removed)
        }
        let entries = diff(base.transactions, local.transactions)
        let others = [
            diff(base.accounts, local.accounts), diff(base.trips, local.trips),
            diff(base.categories, local.categories), diff(base.recurring, local.recurring),
        ]
        entryIDs = entries.0
        deletedEntryIDs = entries.1
        count =
            entries.0.count + entries.1.count + others.reduce(0) { $0 + $1.0.count + $1.1.count }
            + (base.currency == local.currency ? 0 : 1)
    }
}

/// A ledger record the merge compares field by field.
public protocol MergeableRecord: Equatable, Sendable {
    var id: String { get }
    /// Calls `merger.take` once for every stored property. A property left out would lose
    /// local edits; `LedgerMergeTests` checks the count against the type's stored properties.
    static func mergeFields(_ merger: inout FieldMerger<Self>)
}

/// Copies each field this device edited (local differs from the original) over the remote copy.
public struct FieldMerger<Record> {
    public private(set) var merged: Record
    let original: Record
    let local: Record
    /// The number of fields visited, for the completeness test.
    public private(set) var fieldCount = 0

    public init(merged: Record, original: Record, local: Record) {
        self.merged = merged
        self.original = original
        self.local = local
    }

    public mutating func take<Value: Equatable>(_ field: WritableKeyPath<Record, Value>) {
        fieldCount += 1
        if local[keyPath: field] != original[keyPath: field] { merged[keyPath: field] = local[keyPath: field] }
    }
}

extension PaymentAccount: MergeableRecord {
    public static func mergeFields(_ merger: inout FieldMerger<Self>) {
        merger.take(\.id)
        merger.take(\.name)
        merger.take(\.type)
    }
}

extension Trip: MergeableRecord {
    public static func mergeFields(_ merger: inout FieldMerger<Self>) {
        merger.take(\.id)
        merger.take(\.name)
        merger.take(\.startDate)
        merger.take(\.endDate)
        merger.take(\.sharedHouseholdId)
    }
}

extension LedgerCategory: MergeableRecord {
    public static func mergeFields(_ merger: inout FieldMerger<Self>) {
        merger.take(\.id)
        merger.take(\.name)
        merger.take(\.icon)
        merger.take(\.color)
        merger.take(\.kind)
    }
}

extension LedgerEntry: MergeableRecord {
    public static func mergeFields(_ merger: inout FieldMerger<Self>) {
        merger.take(\.id)
        merger.take(\.title)
        merger.take(\.kind)
        merger.take(\.total)
        merger.take(\.share)
        merger.take(\.categoryId)
        merger.take(\.accountId)
        merger.take(\.tripId)
        merger.take(\.date)
        merger.take(\.note)
        // The receipt is one value (id, name, MIME, URI), as the legacy JSON field was.
        merger.take(\.receipt)
        merger.take(\.recurringId)
    }
}

extension RecurringRule: MergeableRecord {
    public static func mergeFields(_ merger: inout FieldMerger<Self>) {
        merger.take(\.id)
        merger.take(\.title)
        merger.take(\.kind)
        merger.take(\.total)
        merger.take(\.share)
        merger.take(\.categoryId)
        merger.take(\.accountId)
        merger.take(\.date)
        merger.take(\.note)
        merger.take(\.frequency)
        merger.take(\.nextDate)
        merger.take(\.anchorDay)
        merger.take(\.active)
    }
}
