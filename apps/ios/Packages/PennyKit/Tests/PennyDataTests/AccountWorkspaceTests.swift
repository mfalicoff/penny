import Foundation
import PennyData
import PennyDomain
import Testing

/// `AccountWorkspace`: the shell's `LedgerWorkspace` over the real offline engine. The flow
/// tests drive it with the MAZ-71 harness (real `AuthController`, `OfflineLedgerStore` and
/// `LedgerSyncModel` against the fake server).
@Suite("Account workspace (shell over offline sync)")
@MainActor
struct AccountWorkspaceTests {
    let harness = SyncHarness()
    let workspace: AccountWorkspace

    init() {
        harness.server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch", title: "Lunch")]))
        workspace = AccountWorkspace(model: harness.model, scope: Offline.scope())
    }

    private func signedIn() async throws {
        try await harness.signIn()
        await harness.waitFor(.upToDate, "first download")
    }

    private static let taxi = Offline.entry("taxi", title: "Taxi to airport")
    private static let summary = ChangeSummary(title: "Expense added", detail: "Taxi to airport", kind: .expense)

    // MARK: Mapping

    private static let issue = WorkspaceProblem(.server, "x")

    @Test(
        "whenThePhaseChanges_AccountWorkspace_ShouldReportTheMatchingSyncStatus",
        arguments: [
            (LedgerSyncState.Phase.upToDate, SyncStatus.upToDate(lastSynced: Date(timeIntervalSince1970: 1))),
            (.loading, .syncing(pending: 2)),
            (.syncing, .syncing(pending: 2)),
            (.pending, .syncing(pending: 2)),
            (.offline, .offline(pending: 2, lastSynced: Date(timeIntervalSince1970: 1))),
            (.failed(.offline), .offline(pending: 2, lastSynced: Date(timeIntervalSince1970: 1))),
            (.sessionExpired, .signInRequired(pending: 2)),
        ])
    func status(phase: LedgerSyncState.Phase, expected: SyncStatus) {
        let state = LedgerSyncState(
            phase: phase, pending: PendingChanges(entryIDs: ["a"], deletedEntryIDs: ["b"], count: 2),
            lastSyncedAt: Date(timeIntervalSince1970: 1), scope: Offline.scope())
        #expect(AccountWorkspace.status(state) == expected)
    }

    @Test("whenStorageOrSyncFails_AccountWorkspace_ShouldReportAFailingProblemWithTheChangesKept")
    func failingStatus() {
        func status(_ phase: LedgerSyncState.Phase) -> SyncStatus {
            AccountWorkspace.status(
                LedgerSyncState(
                    phase: phase, pending: PendingChanges(entryIDs: ["a"], deletedEntryIDs: [], count: 1),
                    lastSyncedAt: nil, scope: Offline.scope()))
        }
        let kinds: [(LedgerSyncState.Phase, WorkspaceProblem.Kind)] = [
            (.failed(.serverUnreachable), .unreachable),
            (.failed(.serverUnavailable(retryAfter: 30)), .server),
            (.failed(.rejected(message: "Too large")), .server),
            (.failed(.conflictRetriesExhausted), .conflict),
            (.failed(.incompatibleServerData), .server),
            (.failed(.storageWriteFailed), .storage),
            (.storageUnavailable, .storage),
            (.storageUnreadable, .storageUnreadable),
            (.storageNewerFormat, .storage),
        ]
        for (phase, kind) in kinds {
            guard case .failing(1, let problem) = status(phase) else {
                Issue.record("\(phase) should be failing with 1 change waiting")
                continue
            }
            #expect(problem.kind == kind, "\(phase)")
            #expect(!problem.message.isEmpty)
        }
        #expect(
            AccountWorkspace.problem(.rejected(message: "Too large")).message
                == "Too large. Your changes are kept on this device.")
    }

    @Test("whenTheLedgerCantBeShown_AccountWorkspace_ShouldFailTheLoadWithItsNextStep")
    func loadMapping() {
        let ledger = Offline.ledger()
        #expect(AccountWorkspace.load(.upToDate, ledger: ledger) == .ready(ledger))
        #expect(AccountWorkspace.load(.offline, ledger: ledger) == .ready(ledger), "offline still shows the copy")
        #expect(AccountWorkspace.load(.sessionExpired, ledger: ledger) == .ready(ledger))
        #expect(AccountWorkspace.load(.loading, ledger: nil) == .loading)
        #expect(AccountWorkspace.load(.signedOut, ledger: nil) == .loading)
        #expect(AccountWorkspace.load(.offline, ledger: nil).problemKind == .offline)
        #expect(AccountWorkspace.load(.failed(.serverUnreachable), ledger: nil).problemKind == .unreachable)
        #expect(AccountWorkspace.load(.sessionExpired, ledger: nil).problemKind == .sessionExpired)
        #expect(AccountWorkspace.load(.storageUnavailable, ledger: nil).problemKind == .storage)
        #expect(
            AccountWorkspace.load(.storageUnreadable, ledger: ledger).problemKind == .storageUnreadable,
            "an unreadable copy offers recovery even if a ledger was shown before")
        guard case .unavailable(let message) = AccountWorkspace.load(.storageNewerFormat, ledger: ledger) else {
            Issue.record("a newer format can't be opened")
            return
        }
        #expect(message.contains("Update Penny"))
    }

    @Test("whenASaveFails_AccountWorkspace_ShouldMapTheErrorAndKeepItsMessage")
    func saveFailureMapping() {
        #expect(AccountWorkspace.failure(.rule(.categoryRemoved)) == .rule(.categoryRemoved))
        #expect(AccountWorkspace.failure(.writeFailed) == .storage(LedgerSaveError.writeFailed.message))
        #expect(AccountWorkspace.failure(.storageUnreadable) == .storage(LedgerSaveError.storageUnreadable.message))
        #expect(AccountWorkspace.failure(.notLoaded) == .unavailable(LedgerSaveError.notLoaded.message))
        #expect(AccountWorkspace.failure(.unavailable) == .unavailable(LedgerSaveError.unavailable.message))
        #expect(AccountWorkspace.failure(.invalid([])) == .unavailable(LedgerSaveError.invalid([]).message))
    }

    // MARK: Flows

    @Test("whenSavedOfflineThenReconnected_AccountWorkspace_ShouldGoFromPendingToSynced")
    func savePendingSynced() async throws {
        #expect(workspace.load == .loading && !workspace.isDemo)
        try await signedIn()
        #expect(workspace.load.ledger?.entry(id: "lunch")?.title == "Lunch")
        guard case .upToDate(let synced?) = workspace.sync else {
            Issue.record("expected up to date with a sync time, got \(workspace.sync)")
            return
        }

        await harness.goOffline()
        let saved = try await workspace.commit(.saveEntry(Self.taxi), summary: Self.summary).get()
        #expect(saved.summary == Self.summary)
        #expect(workspace.load.ledger?.entry(id: "taxi") != nil, "shown at once")
        #expect(workspace.pendingEntryIDs == ["taxi"])
        #expect(workspace.sync == .offline(pending: 1, lastSynced: synced))
        #expect(try harness.store.files.load(Offline.scope())?.pending.entryIDs == ["taxi"], "on disk")
        #expect(harness.server.ledger(Offline.alex)?.entry(id: "taxi") == nil)

        harness.goOnline()
        await eventually("synced") {
            workspace.sync == .upToDate(lastSynced: synced) && workspace.pendingEntryIDs.isEmpty
        }
        #expect(harness.server.ledger(Offline.alex)?.entry(id: "taxi")?.title == "Taxi to airport")
    }

    @Test("whenASaveIsRefused_AccountWorkspace_ShouldChangeNothingSoTheDraftStays")
    func refusedSave() async throws {
        try await signedIn()
        let before = workspace.load
        let result = await workspace.commit(.changeCurrency(.usd), summary: ChangeSummary(title: "Currency updated"))
        #expect(result == .failure(.rule(.currencyLocked)))
        #expect(workspace.load == before)
        #expect(workspace.pendingEntryIDs.isEmpty)
    }

    @Test("whenUndoIsTapped_AccountWorkspace_ShouldSaveTheInverseAndSyncIt")
    func undo() async throws {
        try await signedIn()
        let saved = try await workspace.commit(.saveEntry(Self.taxi), summary: Self.summary).get()
        #expect(saved.canUndo)
        await eventually("save synced") { harness.server.ledger(Offline.alex)?.entry(id: "taxi") != nil }

        try await workspace.undo(saved).get()
        #expect(workspace.load.ledger?.entry(id: "taxi") == nil)
        await eventually("undo synced") {
            harness.server.ledger(Offline.alex)?.entry(id: "taxi") == nil && workspace.pendingEntryIDs.isEmpty
        }
        #expect(harness.server.ledger(Offline.alex)?.entry(id: "lunch") != nil)
        let again = await workspace.undo(saved)
        #expect(again.failure == .unavailable(AccountWorkspace.undoTooLate), "only once")
    }

    @Test("whenTheSavedRecordChangedOnAnotherDevice_AccountWorkspace_ShouldRefuseUndoAndKeepTheirEdit")
    func staleUndo() async throws {
        try await signedIn()
        let saved = try await workspace.commit(.saveEntry(Self.taxi), summary: Self.summary).get()
        await eventually("save synced") { harness.server.ledger(Offline.alex)?.entry(id: "taxi") != nil }
        harness.server.edit(Offline.alex) { ledger in
            ledger.transactions = ledger.transactions.map { entry in
                var entry = entry
                if entry.id == "taxi" { entry.note = "receipt in email" }
                return entry
            }
        }
        await workspace.syncNow()
        await eventually("web edit arrived") { workspace.load.ledger?.entry(id: "taxi")?.note == "receipt in email" }

        let result = await workspace.undo(saved)
        #expect(result.failure == .unavailable(AccountWorkspace.undoTooLate))
        #expect(workspace.load.ledger?.entry(id: "taxi")?.note == "receipt in email")
        #expect(workspace.pendingEntryIDs.isEmpty)
    }

    @Test("whenTheServerEndsTheSession_AccountWorkspace_ShouldAskForSignInAndKeepTheCount")
    func sessionExpiry() async throws {
        try await signedIn()
        harness.server.revoke(Offline.alex)
        _ = try await workspace.commit(.saveEntry(Self.taxi), summary: Self.summary).get()
        await eventually("session ended") { workspace.sync == .signInRequired(pending: 1) }
        let refused = await workspace.commit(.saveEntry(Offline.entry("bus")), summary: Self.summary)
        #expect(
            refused == .failure(.unavailable(LedgerSaveError.unavailable.message)), "nothing saved while signed out")
    }

    @Test("whenTheCopyIsUnreadable_AccountWorkspace_ShouldOfferRecoveryThroughReload")
    func unreadableRecovery() async throws {
        try await signedIn()
        try Data("not json".utf8).write(to: harness.store.files.url(for: Offline.scope()))
        let relaunched = harness.relaunched(online: true)
        let workspace = AccountWorkspace(model: relaunched.model, scope: Offline.scope())
        await relaunched.auth.restore()
        await relaunched.waitFor(.storageUnreadable)
        #expect(workspace.load.problemKind == .storageUnreadable)
        let refused = await workspace.commit(.saveEntry(Self.taxi), summary: Self.summary)
        #expect(refused == .failure(.storage(LedgerSaveError.storageUnreadable.message)))

        await workspace.reload()
        await relaunched.waitFor(.upToDate, "recovered from the server")
        #expect(workspace.load.ledger?.entry(id: "lunch") != nil)
    }

    @Test("whenTheModelIsOnAnotherAccount_AccountWorkspace_ShouldShowNothingAndSaveNothing")
    func otherAccount() async throws {
        try await signedIn()
        let sams = AccountWorkspace(model: harness.model, scope: Offline.scope(Offline.sam))
        #expect(sams.load == .loading)
        #expect(sams.pendingEntryIDs.isEmpty)
        let result = await sams.commit(.saveEntry(Self.taxi), summary: Self.summary)
        #expect(result == .failure(.unavailable(LedgerSaveError.unavailable.message)))
        #expect(harness.model.ledger?.entry(id: "taxi") == nil)
    }
}

extension LedgerLoad {
    fileprivate var problemKind: WorkspaceProblem.Kind? {
        if case .failed(let problem) = self { return problem.kind }
        return nil
    }
}

extension Result where Success == Void, Failure == SaveFailure {
    fileprivate var failure: SaveFailure? {
        if case .failure(let failure) = self { return failure }
        return nil
    }
}
