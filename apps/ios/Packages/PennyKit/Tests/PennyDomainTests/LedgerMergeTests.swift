import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Ledger merge")
struct LedgerMergeTests {
    @Test("whenGoldenMergeCase_LedgerMerge_ShouldMatchMergeConflictsFixture")
    func goldenCases() throws {
        let fixture = try Fixtures.decode(MergeFixture.self, from: "merge-conflicts.json")
        #expect(fixture.cases.count >= 10)
        for item in fixture.cases {
            let merged = LedgerMerge.merge(
                base: try ContractLedger.ledger(item.base), local: try ContractLedger.ledger(item.local),
                remote: try ContractLedger.ledger(item.remote))
            #expect(merged == (try ContractLedger.ledger(item.expected)), "\(item.name)")
        }
    }

    @Test("whenParityMergeCase_LedgerMerge_ShouldMatchParityFixture")
    func parityCase() throws {
        // parity-cases.json `merge`: one entry's note and share, edited on each side.
        let parity = try Fixtures.decode(ParityFixture.self, from: "parity-cases.json")
        struct Fields: Decodable {
            var note: String
            var share: Int64
        }
        func ledger(_ value: JSONValue) throws -> PennyDomain.Ledger {
            let fields = try JSONDecoder().decode(Fields.self, from: JSONEncoder().encode(value))
            return Sample.ledger(transactions: [
                Sample.entry("a", "2026-10-01", share: fields.share, total: 1000, note: fields.note)
            ])
        }
        let merged = LedgerMerge.merge(
            base: try ledger(parity.merge.base), local: try ledger(parity.merge.local),
            remote: try ledger(parity.merge.remote))
        #expect(merged == (try ledger(parity.merge.expected)))
    }

    @Test("whenRecordTypesMerge_FieldMerger_ShouldVisitEveryStoredProperty")
    func everyFieldMerges() {
        func visited<Record: MergeableRecord>(_ sample: Record) -> (Int, Int) {
            var merger = FieldMerger(merged: sample, original: sample, local: sample)
            Record.mergeFields(&merger)
            return (merger.fieldCount, Mirror(reflecting: sample).children.count)
        }
        let rule = Sample.rule("rent", start: "2026-01-01")
        let entry = Sample.entry("a", "2026-01-01")
        for (count, properties) in [
            visited(Sample.visa), visited(Sample.lisbon), visited(PennyDomain.Ledger.investmentCategory),
            visited(entry), visited(rule),
        ] {
            #expect(count == properties)
        }
    }

    @Test("whenBothDevicesEditDifferentFieldsOfTheSameEntry_LedgerMerge_ShouldKeepBoth")
    func independentFields() {
        let base = Sample.ledger(transactions: [Sample.entry("a", "2026-10-01", share: 1200, note: "")])
        var local = base
        local.transactions[0].note = "From the phone"
        var remote = base
        remote.transactions[0].share = 1500
        remote.transactions[0].total = 1500
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.transactions == [Sample.entry("a", "2026-10-01", share: 1500, note: "From the phone")])
    }

    @Test("whenBothDevicesEditTheSameField_LedgerMerge_ShouldKeepTheLocalValue")
    func sameField() {
        let base = Sample.ledger(transactions: [Sample.entry("a", "2026-10-01", title: "Coffee")])
        var local = base
        local.transactions[0].title = "Phone title"
        var remote = base
        remote.transactions[0].title = "Web title"
        #expect(LedgerMerge.merge(base: base, local: local, remote: remote).transactions[0].title == "Phone title")
    }

    @Test("whenBothDevicesCaughtUpTheSameRule_LedgerMerge_ShouldRecordEachOccurrenceOnce")
    func bothDevicesMaterialize() {
        let today = CalendarDate.day("2026-12-05")
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-01", next: "2026-11-01")])
        let local = Recurrence.materialize(base, today: today)
        let remote = Recurrence.materialize(base, today: today)
        let merged = Recurrence.materialize(LedgerMerge.merge(base: base, local: local, remote: remote), today: today)
        #expect(merged.transactions.map(\.id) == ["rent:2026-11-01", "rent:2026-12-01"])
        #expect(merged.rule(id: "rent")?.nextDate == .day("2027-01-01"))
    }

    @Test("whenAnotherDeviceRecordedAndEditedAnOccurrenceThisDeviceAlsoRecorded_LedgerMerge_ShouldKeepTheEdit")
    func remoteEditOfSharedOccurrence() {
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-01", next: "2026-11-01")])
        let local = Recurrence.materialize(base, today: .day("2026-11-03"))
        var remote = Recurrence.materialize(base, today: .day("2026-11-02"))
        remote.transactions[0].note = "Paid by transfer"
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.transactions.map(\.note) == ["Paid by transfer"])
    }

    @Test("whenAnotherDeviceDeletedAnOccurrenceThisDeviceAlsoRecorded_LedgerMerge_ShouldNotBringItBack")
    func deletedOccurrenceStaysDeleted() {
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-01", next: "2026-11-01")])
        let local = Recurrence.materialize(base, today: .day("2026-11-03"))
        var remote = Recurrence.materialize(base, today: .day("2026-11-02"))
        remote.transactions.removeAll { $0.id == "rent:2026-11-01" }
        let merged = Recurrence.materialize(
            LedgerMerge.merge(base: base, local: local, remote: remote), today: .day("2026-11-03"))
        #expect(merged.transactions.isEmpty)
        #expect(merged.rule(id: "rent")?.nextDate == .day("2026-12-01"))
    }

    @Test("whenTheServerDeletedARuleThisDeviceOnlyCaughtUp_LedgerMerge_ShouldKeepTheRuleAndItsOccurrencesDeleted")
    func remotelyDeletedRuleStaysDeleted() {
        let base = Sample.ledger(recurring: [
            Sample.rule("rent", start: "2026-10-06", next: "2026-11-06"),
            Sample.rule("gym", start: "2026-10-20", next: "2026-11-20"),
        ])
        // Offline, the phone records rent:2026-11-06 and moves the rule to December.
        let local = Recurrence.materialize(base, today: .day("2026-11-08"))
        #expect(local.transactions.map(\.id) == ["rent:2026-11-06"])
        var remote = base
        remote.recurring.removeAll { $0.id == "rent" }
        let merged = Recurrence.materialize(
            LedgerMerge.merge(base: base, local: local, remote: remote), today: .day("2026-11-08"))
        #expect(merged.recurring.map(\.id) == ["gym"])
        #expect(merged.transactions.isEmpty)
    }

    @Test("whenTheServerDeletedARuleThisDeviceEdited_LedgerMerge_ShouldBringTheEditedRuleBack")
    func editedRuleDeletedRemotelyComesBack() {
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-06", next: "2026-11-06")])
        var local = Recurrence.materialize(base, today: .day("2026-11-08"))
        local.recurring[0].note = "New lease"
        var remote = base
        remote.recurring.removeAll()
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.recurring.map(\.note) == ["New lease"])
        #expect(merged.rule(id: "rent")?.nextDate == .day("2026-12-06"))
        #expect(merged.transactions.map(\.id) == ["rent:2026-11-06"])
    }

    @Test("whenTheServerDeletedARuleAndThisDeviceEditedItsOccurrence_LedgerMerge_ShouldKeepTheEditedOccurrence")
    func editedOccurrenceOfDeletedRuleSurvives() {
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-06", next: "2026-11-06")])
        var local = Recurrence.materialize(base, today: .day("2026-11-08"))
        local.transactions[0].note = "Paid late"
        var remote = base
        remote.recurring.removeAll()
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.recurring.isEmpty)
        #expect(merged.transactions.map(\.note) == ["Paid late"])
    }

    @Test("whenThisDeviceEditedAnOccurrenceTheServerDeleted_LedgerMerge_ShouldKeepTheEdit")
    func editedOccurrenceSurvives() {
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-01", next: "2026-11-01")])
        var local = Recurrence.materialize(base, today: .day("2026-11-03"))
        local.transactions[0].note = "Paid late"
        var remote = Recurrence.materialize(base, today: .day("2026-11-02"))
        remote.transactions.removeAll()
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.transactions.map(\.note) == ["Paid late"])
    }

    @Test("whenTheServerSkippedAheadButNeverRecordedTheDate_LedgerMerge_ShouldFollowTheServerSchedule")
    func remoteResumeSkipsDates() {
        // Paused and resumed on the web: the server skipped November without recording it.
        let base = Sample.ledger(recurring: [Sample.rule("rent", start: "2026-10-01", next: "2026-11-01")])
        let local = Recurrence.materialize(base, today: .day("2026-11-03"))
        var remote = base
        remote.recurring[0].nextDate = .day("2026-12-01")
        let merged = LedgerMerge.merge(base: base, local: local, remote: remote)
        #expect(merged.transactions.isEmpty)
        #expect(merged.rule(id: "rent")?.nextDate == .day("2026-12-01"))
    }

    @Test("whenLocalChangesExist_PendingChanges_ShouldCountRecordsAndNameEntries")
    func pendingChanges() {
        let base = Sample.ledger(transactions: [Sample.entry("a", "2026-10-01"), Sample.entry("b", "2026-10-02")])
        var local = base
        local.transactions.removeAll { $0.id == "a" }
        local.transactions[0].note = "edited"
        local.transactions.append(Sample.entry("c", "2026-10-03"))
        local.accounts.removeAll()
        local.currency = .usd
        let pending = PendingChanges(base: base, local: local)
        #expect(pending.entryIDs == ["b", "c"])
        #expect(pending.deletedEntryIDs == ["a"])
        #expect(pending.count == 5)
        #expect(PendingChanges(base: base, local: base) == .none)
    }
}
