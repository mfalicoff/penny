import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyUI

/// The shell's side of motion (MAZ-287): which way the month moved, and one haptic per action
/// the person takes, none for changes they didn't make.
@Suite("Motion and haptics in the shell (MAZ-287)")
struct MotionShellTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    private func shell(_ ledger: Ledger = Ledger()) -> ShellModel {
        ShellModel(workspace: FixedWorkspace(load: .ready(ledger)), session: .demo, today: today)
    }

    @Test("whenTheMonthChanges_ShellModel_ShouldSayWhetherItMovedEarlier")
    func monthDirection() throws {
        let shell = shell()
        let november = MonthKey(today)
        shell.month = try #require(november.shifted(by: -1))
        #expect(shell.monthMovedEarlier)
        shell.month = november
        #expect(!shell.monthMovedEarlier)
        shell.month = november
        #expect(!shell.monthMovedEarlier, "setting the same month keeps the direction")
    }

    @Test("whenAnEntryIsDeleted_ShellModel_ShouldPlayTheDeleteHapticNotTheSaveOne")
    func deleteHaptic() async {
        let lunch = LedgerEntry(
            id: "lunch", title: "Lunch", kind: .expense, total: 1280, share: 1280, categoryId: "food",
            date: CalendarDate(year: 2026, month: 11, day: 2) ?? .earliest)
        let shell = shell(Ledger(transactions: [lunch]))
        #expect(await shell.delete(lunch) == nil)
        #expect(shell.deletedCount == 1)
        #expect(shell.savedCount == 0)
        #expect(shell.toast != nil, "the toast still offers Undo")
    }

    @Test("whenASyncTheyDidNotAskForEnds_ShellModel_ShouldPlayNoHaptic")
    func unrequestedSync() {
        let shell = shell()
        shell.syncChanged(to: .upToDate(lastSynced: nil))
        shell.syncChanged(to: .failing(pending: 1, problem: WorkspaceProblem(.server, "Server error")))
        #expect(shell.syncSucceededCount == 0 && shell.syncFailedCount == 0)
    }

    @Test("whenTheirSyncNowEnds_ShellModel_ShouldPlayOneSuccessOrErrorHaptic")
    func requestedSync() async {
        let shell = shell()
        await shell.syncNow()
        shell.syncChanged(to: .syncing(pending: 1))
        #expect(shell.syncSucceededCount == 0, "nothing while it runs")
        shell.syncChanged(to: .upToDate(lastSynced: nil))
        shell.syncChanged(to: .upToDate(lastSynced: nil))
        #expect(shell.syncSucceededCount == 1, "one haptic per Sync now")

        await shell.syncNow()
        shell.syncChanged(to: .offline(pending: 2, lastSynced: nil))
        #expect(shell.syncFailedCount == 1)
    }
}
