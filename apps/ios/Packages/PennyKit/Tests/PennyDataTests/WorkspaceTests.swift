import Foundation
import PennyData
import PennyDomain
import Testing

@MainActor
@Suite("Demo and workspace states")
struct WorkspaceTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    @Test("whenTheDemoChangesItsLedger_DemoWorkspace_ShouldNotAffectAnotherDemoOrSync")
    func isolation() async throws {
        let first = DemoWorkspace(today: today)
        let second = DemoWorkspace(today: today)
        let before = try #require(first.load.ledger)
        let entry = try #require(before.transactions.first)
        _ = try await first.commit(.deleteEntry(entry), summary: ChangeSummary(title: "Deleted")).get()
        #expect(first.load.ledger?.entry(id: entry.id) == nil)
        #expect(second.load.ledger == before, "each demo starts from fresh sample data")
        #expect(first.sync == .localOnly && first.pendingEntryIDs.isEmpty && first.isDemo)
    }

    @Test("whenUndoIsTapped_DemoWorkspace_ShouldRestoreTheLedgerOnlyForTheLatestChange")
    func undo() async throws {
        let demo = DemoWorkspace(today: today)
        let original = try #require(demo.load.ledger)
        let entries = original.transactions
        let first = try await demo.commit(.deleteEntry(entries[0]), summary: ChangeSummary(title: "Deleted")).get()
        let second = try await demo.commit(.deleteEntry(entries[1]), summary: ChangeSummary(title: "Deleted")).get()
        let tooLate = await demo.undo(first)
        #expect(throws: SaveFailure.self) { try tooLate.get() }
        try await demo.undo(second).get()
        #expect(demo.load.ledger?.entry(id: entries[1].id) != nil)
        #expect(demo.load.ledger?.entry(id: entries[0].id) == nil)
    }

    @Test("whenARuleRefusesAChange_DemoWorkspace_ShouldKeepTheLedgerAndReportTheRule")
    func refused() async throws {
        let demo = DemoWorkspace(today: today)
        let before = demo.load.ledger
        let result = await demo.commit(.changeCurrency(.usd), summary: ChangeSummary(title: "Currency updated"))
        #expect(result == .failure(.rule(.currencyLocked)))
        #expect(demo.load.ledger == before)
        #expect(SaveFailure.rule(.currencyLocked).message == "Currency can only be changed before adding entries.")
    }

    @Test("whenSignedInBeforeOfflineSync_UnavailableWorkspace_ShouldRefuseSavesAndKeepTheDraft")
    func unavailable() async {
        let workspace = UnavailableWorkspace()
        let result = await workspace.commit(.changeCurrency(.usd), summary: ChangeSummary(title: "x"))
        guard case .failure(.unavailable(let message)) = result else {
            Issue.record("expected an unavailable failure")
            return
        }
        #expect(message.contains("draft is kept"))
        #expect(workspace.load == .unavailable(UnavailableWorkspace.message))
    }

    @Test("whenStatusesCompared_SyncStatus_ShouldCountPendingAndFlagOnlyProblems")
    func status() {
        let problem = WorkspaceProblem(.server, "The server didn't respond.")
        #expect(SyncStatus.offline(pending: 2, lastSynced: nil).pending == 2)
        #expect(SyncStatus.offline(pending: 2, lastSynced: nil).needsAttention)
        #expect(SyncStatus.failing(pending: 1, problem: problem).needsAttention)
        #expect(SyncStatus.signInRequired(pending: 3).pending == 3)
        #expect(!SyncStatus.syncing(pending: 1).needsAttention)
        #expect(!SyncStatus.upToDate(lastSynced: nil).needsAttention)
        #expect(!SyncStatus.localOnly.needsAttention && SyncStatus.localOnly.pending == 0)
    }
}
