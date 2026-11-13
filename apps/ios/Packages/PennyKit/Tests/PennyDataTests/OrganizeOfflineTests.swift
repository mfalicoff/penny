import Foundation
import PennyData
import PennyDomain
import Testing

/// Accounts, categories and schedule changes made offline are kept on the device, survive a
/// relaunch, and reach the server when the connection returns (MAZ-74 over the MAZ-71 engine).
@Suite("Organize changes offline")
@MainActor
struct OrganizeOfflineTests {
    let harness = SyncHarness()
    let workspace: AccountWorkspace

    private static let joint = PaymentAccount(id: "joint", name: "Joint chequing", type: .bank)
    private static let utilities = LedgerCategory(
        id: "utilities", name: "Utilities", icon: "flash-outline", color: "#0FA3A3", kind: .expense)

    init() {
        harness.server.addAccount(
            Offline.alex,
            ledger: Offline.ledger([Offline.entry("lunch")], rules: [Offline.rule("rent", next: "2026-12-01")]))
        workspace = AccountWorkspace(model: harness.model, scope: Offline.scope())
    }

    @Test("whenOrganizeChangesAreSavedOffline_AccountWorkspace_ShouldKeepThemThroughARelaunchAndSyncThem")
    func offlinePersistence() async throws {
        try await harness.signIn()
        await harness.waitFor(.upToDate, "first download")
        await harness.goOffline()

        let summary = ChangeSummary(title: "Saved")
        _ = try await workspace.commit(.saveAccount(Self.joint), summary: summary).get()
        _ = try await workspace.commit(.saveCategory(Self.utilities), summary: summary).get()
        let rent = try #require(workspace.load.ledger?.rule(id: "rent"))
        var edited = rent
        edited.accountId = "joint"
        edited.categoryId = "utilities"
        edited.total = 125_000
        edited.share = 125_000
        _ = try await workspace.commit(.saveSchedule(edited, original: rent), summary: summary).get()
        _ = try await workspace.commit(
            .setScheduleActive(id: "rent", active: false, today: .day("2026-11-05")), summary: summary
        ).get()

        let onDisk = try #require(try harness.store.files.load(Offline.scope())?.local)
        #expect(onDisk.account(id: "joint") == Self.joint)
        #expect(onDisk.category(id: "utilities") == Self.utilities)
        #expect(onDisk.rule(id: "rent")?.accountId == "joint" && onDisk.rule(id: "rent")?.active == false)
        #expect(harness.server.ledger(Offline.alex)?.account(id: "joint") == nil, "not sent while offline")

        let relaunched = harness.relaunched(online: false)
        await relaunched.auth.restore()
        await eventually("kept through a relaunch") { relaunched.model.ledger?.account(id: "joint") != nil }
        let restored = try #require(relaunched.model.ledger)
        #expect(restored.category(id: "utilities") == Self.utilities)
        #expect(restored.rule(id: "rent")?.total == 125_000 && restored.rule(id: "rent")?.active == false)

        relaunched.goOnline()
        await relaunched.waitFor(.upToDate, "synced after reconnect")
        let server = try #require(harness.server.ledger(Offline.alex))
        #expect(server.account(id: "joint") == Self.joint)
        #expect(server.category(id: "utilities") == Self.utilities)
        #expect(server.rule(id: "rent")?.categoryId == "utilities" && server.rule(id: "rent")?.active == false)
        #expect(server.entry(id: "lunch") != nil)
    }

    @Test("whenAnAccountInUseIsRemovedOffline_AccountWorkspace_ShouldRefuseAndKeepNothingPending")
    func removalGuardOffline() async throws {
        try await harness.signIn()
        await harness.waitFor(.upToDate, "first download")
        await harness.goOffline()
        let rent = try #require(workspace.load.ledger?.rule(id: "rent"))
        var linked = rent
        linked.accountId = "visa"
        _ = try await workspace.commit(.saveSchedule(linked, original: rent), summary: ChangeSummary(title: "Saved"))
            .get()
        let visa = try #require(workspace.load.ledger?.account(id: "visa"))
        let before = workspace.load
        let result = await workspace.commit(
            .saveAccount(visa, original: visa, remove: true), summary: ChangeSummary(title: "Account removed"))
        #expect(result.failure == .rule(.accountHasEntries))
        #expect(workspace.load == before)
        #expect(try harness.store.files.load(Offline.scope())?.local.account(id: "visa") == visa)
    }
}

extension Result where Success == SavedChange, Failure == SaveFailure {
    fileprivate var failure: SaveFailure? {
        if case .failure(let failure) = self { return failure }
        return nil
    }
}
