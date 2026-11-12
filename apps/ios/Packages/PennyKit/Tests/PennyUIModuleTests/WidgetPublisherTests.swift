import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyUI

@Suite("Widget publisher: writes, sign-out and account switches")
@MainActor
struct WidgetPublisherTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    /// A publisher over a temporary store, counting timeline reloads.
    private final class Harness {
        let root = FileManager.default.temporaryDirectory.appending(path: "widget-publisher-\(UUID().uuidString)")
        var reloads = 0
        var clock = Date(timeIntervalSince1970: 1_794_000_000)
        lazy var store = WidgetSnapshotStore(root: root)
        lazy var publisher = WidgetPublisher(store: store, now: { [unowned self] in clock }) { [unowned self] in
            reloads += 1
        }

        deinit { try? FileManager.default.removeItem(at: root) }
    }

    private func snapshot(left: Int64 = 1000) -> WidgetSnapshot {
        WidgetSnapshot(
            month: "2026-11", currency: "CAD", generatedAt: .distantPast, income: left, spent: 0, invested: 0,
            leftToSpend: left, projectedRemaining: left, recentExpenses: [], waitingToSync: false)
    }

    private func entry(_ id: String, _ date: String, _ share: Int64) -> LedgerEntry {
        LedgerEntry(
            id: id, title: "Entry \(id)", kind: .expense, total: share, share: share, categoryId: "food",
            date: CalendarDate(date) ?? .earliest)
    }

    @Test("whenAccountPublishes_WidgetPublisher_ShouldWriteStampedSnapshotOnceAndReload")
    func publishes() {
        let harness = Harness()
        harness.publisher.ownerChanged(.account("alex"))
        harness.publisher.publish(snapshot(), owner: "alex")
        guard case .snapshot(let stored) = harness.store.read() else {
            Issue.record("A snapshot is stored")
            return
        }
        #expect(stored.generatedAt == harness.clock)
        #expect(harness.store.storedOwner() == "alex")
        #expect(harness.reloads == 1)

        // Unchanged content is not rewritten or reloaded…
        harness.clock.addTimeInterval(60)
        harness.publisher.publish(snapshot(), owner: "alex")
        #expect(harness.reloads == 1)
        // …until it is old enough to restamp, or it changes.
        harness.clock.addTimeInterval(WidgetPublisher.restampAfter)
        harness.publisher.publish(snapshot(), owner: "alex")
        #expect(harness.reloads == 2)
        harness.publisher.publish(snapshot(left: 2000), owner: "alex")
        #expect(harness.reloads == 3)
        #expect(harness.store.snapshot(for: "alex")?.leftToSpend == 2000)
    }

    @Test("whenSignedOut_WidgetPublisher_ShouldClearAndIgnoreLatePublishes")
    func signOut() {
        let harness = Harness()
        harness.publisher.ownerChanged(.account("alex"))
        harness.publisher.publish(snapshot(), owner: "alex")
        harness.publisher.ownerChanged(.nobody)
        #expect(harness.store.read() == .signedOut)
        #expect(harness.reloads == 2)

        // A shell that is going away publishes once more: nothing comes back.
        harness.publisher.publish(snapshot(), owner: "alex")
        #expect(harness.store.read() == .signedOut)
        #expect(harness.reloads == 2)
    }

    @Test("whenAnotherAccountSignsIn_WidgetPublisher_ShouldRemoveThePreviousAccountsSnapshot")
    func accountSwitch() {
        let harness = Harness()
        harness.publisher.ownerChanged(.account("alex"))
        harness.publisher.publish(snapshot(left: 1000), owner: "alex")

        // The new account's shell may publish before the auth change arrives.
        harness.publisher.publish(snapshot(left: 5), owner: "sam")
        #expect(harness.store.storedOwner() == "sam")
        #expect(harness.store.snapshot(for: "sam")?.leftToSpend == 5)
        harness.publisher.ownerChanged(.account("sam"))
        #expect(harness.store.snapshot(for: "sam")?.leftToSpend == 5)
    }

    @Test("whenLaunchingWithAnotherAccountsFile_WidgetPublisher_ShouldClearItBeforePublishing")
    func staleFileAtLaunch() throws {
        let harness = Harness()
        try harness.store.write(snapshot(), owner: "alex")
        harness.publisher.ownerChanged(.unknown)
        #expect(harness.store.storedOwner() == "alex", "restoring keeps what is there")
        harness.publisher.ownerChanged(.account("sam"))
        #expect(harness.store.read() == .signedOut)
        #expect(harness.reloads == 1)
    }

    @Test("whenTheSameAccountRelaunches_WidgetPublisher_ShouldKeepItsSnapshotWithoutRewriting")
    func relaunch() throws {
        let harness = Harness()
        var stored = snapshot()
        stored.generatedAt = harness.clock
        try harness.store.write(stored, owner: "alex")
        harness.publisher.ownerChanged(.account("alex"))
        harness.publisher.publish(snapshot(), owner: "alex")
        #expect(harness.reloads == 0)
        #expect(harness.store.snapshot(for: "alex") == stored)
    }

    @Test("whenShellPublishesWhileSignedOut_WidgetPublisher_ShouldWriteOnlyIfThatAccountSignsInNext")
    func publishBeforeSignIn() {
        let harness = Harness()
        harness.publisher.ownerChanged(.nobody)
        harness.publisher.publish(snapshot(left: 7), owner: "alex")
        #expect(harness.store.read() == .signedOut)
        harness.publisher.ownerChanged(.account("alex"))
        #expect(harness.store.snapshot(for: "alex")?.leftToSpend == 7)

        let other = Harness()
        other.publisher.ownerChanged(.nobody)
        other.publisher.publish(snapshot(left: 7), owner: "alex")
        other.publisher.ownerChanged(.account("sam"))
        #expect(other.store.read() == .signedOut)
    }

    @Test("whenAuthStateChanges_WidgetPublisherOwner_ShouldFollowItAndWaitWhileRestoring")
    func owners() {
        #expect(WidgetPublisher.owner(.signedOut(nil)) == .nobody)
        #expect(WidgetPublisher.owner(.restoring) == .unknown)
        #expect(WidgetPublisher.owner(.keychainUnavailable) == .unknown)
    }

    @Test("whenLedgerIsReady_ShellModelWidgetSnapshot_ShouldSummarizeTodaysMonth")
    func shellSnapshot() {
        let ledger = Ledger(transactions: [entry("a", "2026-11-02", 2500), entry("b", "2026-10-02", 900)])
        let workspace = FixedWorkspace(load: .ready(ledger))
        let shell = ShellModel(workspace: workspace, session: .demo, today: today)
        shell.month = MonthKey(year: 2026, month: 10) ?? shell.month

        let snapshot = shell.widgetSnapshot
        #expect(snapshot?.month == "2026-11", "today's month, whatever month is on screen")
        #expect(snapshot?.spent == 2500)
        #expect(snapshot?.waitingToSync == false)

        workspace.sync = .offline(pending: 2, lastSynced: nil)
        #expect(shell.widgetSnapshot?.waitingToSync == true)
    }

    @Test("whenLoadingOrInTheDemo_ShellModelWidgetSnapshot_ShouldBeNil")
    func noSnapshot() {
        #expect(
            ShellModel(workspace: FixedWorkspace(load: .loading), session: .demo, today: today).widgetSnapshot == nil)
        let demo = DemoWorkspace(today: today)
        #expect(ShellModel(workspace: demo, session: .demo, today: today, leaveDemo: {}).widgetSnapshot == nil)
    }

    @Test("whenSharedRowsHaveNotAnswered_ShellModelWidgetSnapshot_ShouldWaitForThem")
    func waitsForShared() async throws {
        let row = #"""
            {"id":"e1","householdId":"maison","householdCurrency":"CAD","title":"Groceries","date":"2026-11-03",
             "totalCents":9000,"shareCents":3000,"payerUserId":"u","note":"",
             "category":{"name":"Groceries","icon":"basket-outline","color":"#0FA3A3"}}
            """#
        let answer = try JSONDecoder().decode(
            WireHouseholdProjection.self, from: Data(#"{"transactions":[\#(row)],"scheduled":[]}"#.utf8))
        let ledger = Ledger(transactions: [entry("a", "2026-11-02", 2500)])
        let shell = ShellModel(
            workspace: FixedWorkspace(load: .ready(ledger)), session: .demo, today: today,
            sharedProjection: FixedProjection(answer: answer))
        #expect(shell.widgetSnapshot == nil)
        await shell.shared.refresh(MonthKey(today))
        let snapshot = shell.widgetSnapshot
        #expect(snapshot?.spent == 5500, "2,500 personal + 3,000 shared share")
        #expect(snapshot?.recentExpenses.first?.shared == true)
    }
}
