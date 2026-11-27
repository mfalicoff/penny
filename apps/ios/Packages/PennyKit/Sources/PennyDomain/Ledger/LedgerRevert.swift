extension LedgerChange {
    /// The inverse of a change that turned `before` into `after`, for Undo: every record the
    /// change added, edited or removed goes back to its `before` version (at its old place in
    /// the list), and a currency change goes back. Records the change did not touch keep
    /// whatever they are now, so work synced from other devices in between survives.
    ///
    /// Like any other change it is applied to the latest ledger, and it is refused, changing
    /// nothing, when a record it would put back no longer matches `after` (another device or a
    /// later change edited it), or when the currency would change under entries. References a
    /// restore would break (an entry using an account the undo removes) are refused by the
    /// ledger rules the save checks (`Ledger.violations`).
    public static func revert(_ after: Ledger, to before: Ledger) -> LedgerChange {
        LedgerChange { (ledger) throws(LedgerRuleError) in
            var next = ledger
            if before.currency != after.currency {
                guard ledger.currency == after.currency, ledger.transactions.isEmpty, ledger.recurring.isEmpty else {
                    throw .currencyLocked
                }
                next.currency = before.currency
            }
            next.accounts = try restore(
                ledger.accounts, before: before.accounts, after: after.accounts, stale: .accountChangedOnAnotherDevice)
            next.trips = try restore(
                ledger.trips, before: before.trips, after: after.trips, stale: .tripChangedOnAnotherDevice)
            next.categories = try restore(
                ledger.categories, before: before.categories, after: after.categories,
                stale: .categoryChangedOnAnotherDevice)
            next.transactions = try restore(
                ledger.transactions, before: before.transactions, after: after.transactions,
                stale: .entryChangedOnAnotherDevice)
            next.recurring = try restore(
                ledger.recurring, before: before.recurring, after: after.recurring,
                stale: .scheduleChangedOnAnotherDevice)
            // Dismissed suggestions (contract 2.3.0): take back what the change dismissed and
            // dismiss again what it took back; other devices' dismissals stay.
            if before.dismissedSuggestions != after.dismissedSuggestions {
                let old = before.dismissedSuggestions ?? []
                let new = after.dismissedSuggestions ?? []
                let added = new.filter { item in !old.contains { RecurringSuggestions.same($0, item) } }
                let removed = old.filter { item in !new.contains { RecurringSuggestions.same($0, item) } }
                var list = (ledger.dismissedSuggestions ?? []).filter { item in
                    !added.contains { RecurringSuggestions.same($0, item) }
                }
                for item in removed where !list.contains(where: { RecurringSuggestions.same($0, item) }) {
                    list = RecurringSuggestions.adding(item, to: list)
                }
                next.dismissedSuggestions =
                    list.isEmpty && before.dismissedSuggestions == nil && ledger.dismissedSuggestions == new
                    ? nil : list
            }
            return next
        }
    }

    /// Puts back the `before` version of every record that differs between `before` and
    /// `after`, after checking that each one still equals its `after` version in `current`.
    private static func restore<Record: MergeableRecord>(
        _ current: [Record], before: [Record], after: [Record], stale: LedgerRuleError
    ) throws(LedgerRuleError) -> [Record] {
        let old = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let new = Dictionary(after.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let touched = Set(old.keys).union(new.keys).filter { old[$0] != new[$0] }
        guard !touched.isEmpty else { return current }
        let now = Dictionary(current.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for id in touched where now[id] != new[id] { throw stale }
        var result = current.filter { !touched.contains($0.id) }
        // Back at their old index, in order, so an undone edit or delete does not move the record.
        for (index, record) in before.enumerated() where touched.contains(record.id) {
            result.insert(record, at: min(index, result.count))
        }
        return result
    }
}
