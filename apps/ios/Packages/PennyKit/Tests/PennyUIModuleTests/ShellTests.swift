import Foundation
import PennyData
import PennyDomain
import SwiftUI
import Testing

@testable import PennyUI

@Suite("App shell state")
struct ShellTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    private func demoShell() -> (ShellModel, DemoWorkspace) {
        let demo = DemoWorkspace(today: today)
        return (ShellModel(workspace: demo, session: .demo, today: today, leaveDemo: {}), demo)
    }

    @Test("whenASaveSucceeds_ShellModel_ShouldShowTheToastAndTriggerTheSuccessHaptic")
    func saveToast() async throws {
        let workspace = FixedWorkspace(load: .ready(Ledger()))
        let shell = ShellModel(workspace: workspace, session: .demo, today: today)
        let failure = await shell.commit(
            .changeCurrency(.usd), summary: ChangeSummary(title: "Currency updated", detail: "USD"))
        #expect(failure == nil)
        #expect(shell.toast?.summary.title == "Currency updated")
        #expect(shell.savedCount == 1 && shell.failedCount == 0)
        #expect(shell.currency == "USD")
        shell.dismissToast()
        #expect(shell.toast == nil)
    }

    @Test("whenASaveFails_ShellModel_ShouldReturnTheFailureWithoutAToast")
    func saveError() async {
        let problem = WorkspaceProblem(.server, "The server didn't respond. Your draft is kept.")
        let workspace = FixedWorkspace(load: .ready(Ledger()), saveFailure: .server(problem))
        let shell = ShellModel(workspace: workspace, session: .demo, today: today)
        let failure = await shell.commit(.changeCurrency(.usd), summary: ChangeSummary(title: "Currency updated"))
        #expect(failure == .server(problem))
        #expect(shell.toast == nil)
        #expect(shell.failedCount == 1, "the error haptic fires")
        #expect(workspace.load.ledger?.currency == .cad, "nothing was kept; the caller keeps the draft")
    }

    @Test("whenUndoIsTapped_ShellModel_ShouldRevertTheDemoChange")
    func undo() async throws {
        let (shell, demo) = demoShell()
        let entry = try #require(demo.load.ledger?.transactions.first)
        _ = await shell.commit(.deleteEntry(entry), summary: ChangeSummary(title: "Entry deleted"))
        #expect(shell.toast?.canUndo == true)
        #expect(await shell.undoToast() == nil)
        #expect(demo.load.ledger?.entry(id: entry.id) == entry)
        #expect(shell.toast == nil)
    }

    @Test("whenTheDemoIsShown_ShellModel_ShouldHaveNoAccountOrServer")
    func demoIsolation() {
        let (shell, _) = demoShell()
        #expect(shell.isDemo)
        #expect(shell.account == nil && shell.auth == nil)
        #expect(shell.leaveDemo != nil && shell.startDemo == nil)
        #expect(SyncText.line(shell.workspace.sync) == "Demo · changes are temporary")
    }

    @Test("whenTheLedgerHasEntriesOrAHousehold_CurrencyPolicy_ShouldLockWithTheAPIsReason")
    func currencyLock() {
        let empty = Ledger()
        #expect(CurrencyPolicy.lockReason(ledger: empty) == nil)
        #expect(
            CurrencyPolicy.lockReason(ledger: empty, activeHouseholds: 1)
                == "Currency is locked while you're in a household.")
        let used = DemoLedger.make(today: today)
        #expect(CurrencyPolicy.lockReason(ledger: used) == "Currency can only be changed before adding entries.")
        #expect(CurrencyPolicy.options.map(\.rawValue) == ["CAD", "USD", "EUR", "GBP"])
    }

    @Test("whenEntriesAreGrouped_ActivityView_ShouldKeepOrderAndTotalEachDaysNet")
    func dayGroups() throws {
        let report = LedgerReport(ledger: DemoLedger.make(today: today))
        let page = report.activity(.month(MonthKey(today)))
        let days = ActivityView.days(page.entries)
        #expect(days.flatMap(\.entries) == page.entries)
        #expect(Set(days.map(\.day)).count == days.count)
        let first = try #require(days.first)
        let expected = first.entries.reduce(Int64(0)) { $0 + ($1.kind == .income ? $1.share : -$1.share) }
        #expect(first.net == expected)
    }

    @Test("whenSyncStatusChanges_SyncText_ShouldNameWhatWaits")
    func syncText() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(SyncText.line(.upToDate(lastSynced: now.addingTimeInterval(-5)), now: now) == "Synced just now")
        #expect(SyncText.line(.offline(pending: 2, lastSynced: nil)) == "Offline · 2 changes waiting")
        #expect(SyncText.line(.syncing(pending: 1)) == "Syncing 1 change…")
        #expect(SyncText.line(.syncing(pending: 0)) == "Syncing…", "the first download has nothing waiting")
        #expect(SyncText.line(.signInRequired(pending: 2)) == "Sign in again to sync 2 changes")
        #expect(SyncBanner.title(.offline(pending: 1, lastSynced: nil)) == "Offline · 1 change waiting")
        let problem = WorkspaceProblem(.server, "Penny will try again.")
        #expect(SyncBanner.message(.failing(pending: 1, problem: problem)) == "Penny will try again.")
    }

    @Test("whenTheCopyOnThisDeviceCantBeRead_WorkspaceContent_ShouldOfferToDownloadItAgain")
    func loadErrorAction() {
        let unreadable = WorkspaceProblem(.storageUnreadable, "Your entries on this device can't be read.")
        #expect(WorkspaceContent<EmptyView>.actionTitle(unreadable) == "Download again")
        #expect(WorkspaceContent<EmptyView>.actionTitle(WorkspaceProblem(.offline, "Offline.")) == "Try again")
        #expect(WorkspaceContent<EmptyView>.actionTitle(WorkspaceProblem(.storage, "Locked.")) == "Try again")
    }

    @Test("whenChangesWaitOrPayIsExpected_HomeView_ShouldSayWhatProjectedIncludes")
    func projectedLine() {
        let summary = LedgerReport(ledger: DemoLedger.make(today: today)).month(MonthKey(today))
        let line = HomeView.projectedLine(summary, currency: "CAD", pending: 0)
        #expect(line.hasSuffix("projected"))
        #expect(HomeView.projectedLine(summary, currency: "CAD", pending: 2).hasSuffix("as of last sync"))
    }

    @Test("whenScenePhaseChanges_RootView_ShouldTellTheLock")
    func scenePhase() {
        #expect(RootView.activity(.active) == .active)
        #expect(RootView.activity(.inactive) == .inactive)
        #expect(RootView.activity(.background) == .background)
    }

    @Test("whenAppearanceIsChosen_AppearanceModel_ShouldPersistAndApplyIt")
    func appearance() {
        let preferences = EphemeralDevicePreferences()
        let model = AppearanceModel(preferences: preferences)
        #expect(model.colorScheme == nil)
        model.set(.dark)
        #expect(model.colorScheme == .dark)
        #expect(AppearanceModel(preferences: preferences).preference == .dark, "kept for the next launch")
    }

    @Test("whenMonthsAreListed_MonthPicker_ShouldOfferThisMonthAndTheElevenBefore")
    func months() {
        let months = MonthPicker.months(through: MonthKey(today))
        #expect(months.count == 12)
        #expect(months.first == MonthKey(today))
        #expect(months.last == MonthKey(today).shifted(by: -11))
    }
}
