import PennyDomain
import Testing

@Suite("Undo (LedgerChange.revert)")
struct LedgerRevertTests {
    static let coffee = Sample.entry("c1", "2026-11-03", title: "Coffee")
    static let lunch = Sample.entry("c2", "2026-11-04", title: "Lunch")
    static let taxi = Sample.entry("c3", "2026-11-05", title: "Taxi")

    /// Applies `change`, then its revert, to the same ledger.
    private func roundTrip(_ change: LedgerChange, on ledger: PennyDomain.Ledger) throws -> PennyDomain.Ledger {
        let after = try change.apply(to: ledger)
        return try LedgerChange.revert(after, to: ledger).apply(to: after)
    }

    @Test("whenAnAddEditOrDeleteIsUndone_Revert_ShouldRestoreTheLedgerExactly")
    func restoresExactly() throws {
        let ledger = Sample.ledger(transactions: [Self.coffee, Self.lunch, Self.taxi])
        var edited = Self.coffee
        edited.title = "Espresso"
        let changes: [LedgerChange] = [
            .saveEntry(Sample.entry("new", "2026-11-06")),
            .saveEntry(edited, original: Self.coffee),  // moves the entry last
            .deleteEntry(Self.lunch),
            .saveAccount(PaymentAccount(id: "cash", name: "Cash", type: .cash)),
            .saveTrip(Sample.lisbon, original: Sample.lisbon, remove: false),
            .removeSchedule(id: "none"),
        ]
        for change in changes {
            #expect(try roundTrip(change, on: ledger) == ledger, "order included")
        }
    }

    @Test("whenOtherRecordsChangedSinceTheSave_Revert_ShouldKeepThem")
    func keepsUnrelatedWork() throws {
        let before = Sample.ledger(transactions: [Self.coffee])
        let after = try LedgerChange.saveEntry(Self.lunch).apply(to: before)
        // Another device added an entry and renamed the account; it synced before Undo.
        var now = try LedgerChange.saveEntry(Self.taxi).apply(to: after)
        now.accounts[0].name = "Visa Infinite"
        let undone = try LedgerChange.revert(after, to: before).apply(to: now)
        #expect(undone.transactions == [Self.coffee, Self.taxi])
        #expect(undone.accounts.first?.name == "Visa Infinite")
    }

    @Test("whenTheChangedRecordWasEditedSince_Revert_ShouldRefuseAndChangeNothing")
    func refusesStaleRecords() throws {
        let before = Sample.ledger(transactions: [Self.coffee])
        var edited = Self.coffee
        edited.title = "Espresso"
        let after = try LedgerChange.saveEntry(edited, original: Self.coffee).apply(to: before)
        var now = after
        now.transactions[0].note = "edited on the web"
        #expect(throws: LedgerRuleError.entryChangedOnAnotherDevice) {
            try LedgerChange.revert(after, to: before).apply(to: now)
        }
        let removed = try LedgerChange.deleteEntry(edited).apply(to: after)
        #expect(throws: LedgerRuleError.entryChangedOnAnotherDevice, "deleted since: nothing to put back") {
            try LedgerChange.revert(after, to: before).apply(to: removed)
        }
    }

    @Test("whenACurrencyChangeIsUndone_Revert_ShouldOnlyChangeItBackWhileTheLedgerHasNoEntries")
    func currency() throws {
        let before = PennyDomain.Ledger()
        let after = try LedgerChange.changeCurrency(.usd).apply(to: before)
        #expect(try LedgerChange.revert(after, to: before).apply(to: after).currency == .cad)
        let used = try LedgerChange.saveEntry(Self.coffee).apply(to: after)
        #expect(throws: LedgerRuleError.currencyLocked) { try LedgerChange.revert(after, to: before).apply(to: used) }
    }

    @Test("whenNothingChanged_Revert_ShouldLeaveTheLedgerAsItIs")
    func noChange() throws {
        let ledger = Sample.ledger(transactions: [Self.coffee])
        var now = ledger
        now.transactions.append(Self.lunch)
        #expect(try LedgerChange.revert(ledger, to: ledger).apply(to: now) == now)
    }
}
