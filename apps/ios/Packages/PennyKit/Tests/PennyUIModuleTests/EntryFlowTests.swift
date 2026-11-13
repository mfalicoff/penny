import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

@Suite("Entry screens and Activity (MAZ-73)")
struct EntryFlowTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    private func entry(_ id: String, title: String = "Lunch", category: String = "food") -> LedgerEntry {
        LedgerEntry(
            id: id, title: title, kind: .expense, total: 1280, share: 640, categoryId: category,
            date: CalendarDate(year: 2026, month: 11, day: 2) ?? .earliest)
    }

    @Test("whenTheShellStarts_ShellModel_ShouldShowThisMonthAndSearchTheDemoOnThisDevice")
    func shellDefaults() {
        let shell = ShellModel(workspace: DemoWorkspace(today: today), session: .demo, today: today, leaveDemo: {})
        #expect(shell.activityFilters.period == .month(MonthKey(today)))
        shell.activitySearch.update(ActivityFilters(period: .allTime, query: "coffee"))
        #expect(shell.activitySearch.source == .device(.demo))
    }

    @Test("whenTheFormIsReplacedBeforeSaving_ShellModel_ShouldKeepTheDraftForNextTime")
    func draftKept() {
        let ledger = Ledger()
        let shell = ShellModel(workspace: FixedWorkspace(load: .ready(ledger)), session: .demo, today: today)
        var editor = EntryEditor(new: .expense, today: today, ledger: ledger)
        editor.draft.amount = "18"
        shell.drafts.keep(editor)
        shell.route.openSettings(.categories)
        #expect(!shell.route.isAddEntryPresented)
        shell.route.openAddEntry()
        #expect(shell.drafts.take(.new)?.draft.amount == "18")
    }

    @Test("whenEditIsChosen_ShellModel_ShouldOpenTheFormOnThatEntry")
    func editRequest() {
        let lunch = entry("lunch")
        let shell = ShellModel(
            workspace: FixedWorkspace(load: .ready(Ledger(transactions: [lunch]))), session: .demo, today: today)
        shell.edit(lunch)
        #expect(shell.editingEntry == EntryEditRequest(entry: lunch))
        #expect(ActivityRoute.destination(.recorded(lunch)) == .entry(id: "lunch"))
    }

    @Test("whenALinkArrivesWhileEditing_ShellModel_ShouldCloseTheEditSheetBeforeNavigating")
    func navigateWhileEditing() {
        let lunch = entry("lunch")
        let shell = ShellModel(
            workspace: FixedWorkspace(load: .ready(Ledger(transactions: [lunch]))), session: .demo, today: today)
        shell.edit(lunch)

        shell.navigate { $0.open(.addEntry) }
        #expect(shell.editingEntry == nil, "the edit sheet closes first")
        #expect(!shell.route.isAddEntryPresented, "Add entry waits until the edit sheet has gone")

        shell.sheetDismissed()
        #expect(shell.route.isAddEntryPresented)
        shell.sheetDismissed()
        #expect(shell.route.isAddEntryPresented, "a waiting change applies once")
    }

    @Test("whenASettingsLinkArrivesWhileAddEntryIsOpen_ShellModel_ShouldCloseAddEntryBeforeOpeningSettings")
    func settingsLinkOverAddEntry() {
        let shell = ShellModel(workspace: FixedWorkspace(load: .ready(Ledger())), session: .demo, today: today)
        shell.route.openAddEntry()

        shell.navigate { $0.open(.settings(.categories)) }
        #expect(!shell.route.isAddEntryPresented, "Add entry closes first")
        #expect(!shell.route.isSettingsPresented, "Settings waits until the Add sheet has gone")

        shell.sheetDismissed()
        #expect(shell.route.isSettingsPresented && shell.route.settingsPath == [.categories])
        #expect(!shell.route.isAddEntryPresented)
    }

    @Test("whenALinkArrivesWhileAddEntryIsOpen_ShellModel_ShouldNavigateAtOnceWhenNoSheetMustOpen")
    func tabLinkOverAddEntry() {
        let shell = ShellModel(workspace: FixedWorkspace(load: .ready(Ledger())), session: .demo, today: today)
        shell.route.openAddEntry()
        shell.navigate { $0.open(.activity) }
        #expect(shell.route.tab == .activity && !shell.route.isAddEntryPresented)
    }

    @Test("whenNothingIsBeingEdited_ShellModel_ShouldNavigateAtOnce")
    func navigateDirectly() {
        let shell = ShellModel(workspace: FixedWorkspace(load: .ready(Ledger())), session: .demo, today: today)
        shell.navigate { $0.openSettings(.categories) }
        #expect(shell.route.isSettingsPresented && shell.route.settingsPath == [.categories])

        shell.route.isSettingsPresented = false
        shell.sheetDismissed()
        #expect(!shell.route.isSettingsPresented, "a plain edit sheet dismissal changes nothing")
    }

    @Test("whenDeletingAnEntryThatChangedElsewhere_ShellModel_ShouldRefuseAndKeepIt")
    func staleDelete() async {
        let lunch = entry("lunch")
        var renamed = lunch
        renamed.title = "Team lunch"
        let workspace = FixedWorkspace(load: .ready(Ledger(transactions: [renamed])))
        let shell = ShellModel(workspace: workspace, session: .demo, today: today)
        let failure = await shell.delete(lunch)
        #expect(failure == .rule(.entryChangedBeforeDelete))
        #expect(failure?.message == "This entry changed on another device. Reopen it before deleting.")
        #expect(workspace.load.ledger?.entry(id: "lunch") == renamed)
        #expect(shell.failedCount == 1)
    }

    @Test("whenAnEntryIsDeletedInTheDemo_ShellModel_ShouldConfirmWithUndo")
    func deleteWithUndo() async throws {
        let demo = DemoWorkspace(today: today)
        let shell = ShellModel(workspace: demo, session: .demo, today: today, leaveDemo: {})
        let target = try #require(demo.load.ledger?.transactions.first)
        #expect(await shell.delete(target) == nil)
        #expect(shell.toast?.summary.title == "Entry deleted")
        #expect(shell.toast?.canUndo == true)
        #expect(await shell.undoToast() == nil)
        #expect(demo.load.ledger?.entry(id: target.id) == target)
    }

    @Test("whenTheLedgerOrFiltersChange_ActivityLocalCache_ShouldRecomputeOnlyThen")
    func localCache() {
        let cache = ActivityLocalCache()
        let month = MonthKey(today)
        var ledger = Ledger(transactions: [entry("a", title: "Café"), entry("b", title: "Rent", category: "home")])
        let all = cache.result(ledger, ActivityFilters(period: .month(month)))
        #expect(all.entries.count == 2)
        #expect(cache.result(ledger, ActivityFilters(period: .month(month), query: "cafe")).entries.map(\.id) == ["a"])
        ledger.transactions.append(entry("c", title: "Cafeteria"))
        #expect(
            cache.result(ledger, ActivityFilters(period: .month(month), query: "cafe")).entries.map(\.id) == ["a", "c"])
        #expect(cache.result(ledger, ActivityFilters(period: .month(month), kind: .income)).entries.isEmpty)
    }

    @Test("whenTheSelectedCategoryIsNotFrequent_EntryCategoryChips_ShouldStillShowIt")
    func chips() {
        let ledger = Ledger(transactions: [entry("a", category: "transport"), entry("b", category: "health")])
        let chips = EntryCategoryChips.chips(kind: .expense, selection: "other", ledger: ledger).map(\.id)
        #expect(chips.first == "other")
        #expect(
            chips.dropFirst().prefix(2) == ["transport", "health"]
                || chips.dropFirst().prefix(2) == ["health", "transport"])
        #expect(
            EntryCategoryChips.chips(kind: .income, selection: "other", ledger: ledger).allSatisfy {
                $0.kind == .income
            })
    }

    @Test("whenAnEntryIsSaved_EntrySummary_ShouldNameTheKindAndYourShare")
    func summaries() {
        let ledger = Ledger(currency: .cad)
        let lunch = entry("lunch")
        let added = EntrySummary.saved(lunch, isNew: true, ledger: ledger)
        #expect(added.title == "Expense added")
        #expect(added.detail?.hasPrefix("Food & drinks · ") == true)
        #expect(added.detail?.contains("6.40") == true, "the toast shows your share")
        #expect(EntrySummary.saved(lunch, isNew: false, ledger: ledger).title == "Entry updated")
        #expect(EntrySummary.deleted(lunch, currency: "CAD").title == "Entry deleted")
        #expect(DeleteEntryConfirmation.message(lunch).contains("undo"))
    }

    @Test("whenAPeriodIsDescribed_ActivityPeriodText_ShouldNameItForTheEmptyState")
    func periodText() {
        let month = MonthKey(today)
        #expect(ActivityPeriodText.title(.allTime) == "All time")
        #expect(ActivityPeriodText.title(.year(2026)) == "2026")
        #expect(ActivityPeriodText.scope(ActivityFilters(period: .allTime, kind: .expense)) == "all months expenses")
        #expect(ActivityPeriodText.scope(ActivityFilters(period: .month(month))).hasSuffix(" entries"))
    }

    @Test("whenARowIsRecordedExpectedOrScheduled_EntryRow_ShouldSayItOnceAndKeepTheCategory")
    func rowStatusText() throws {
        let later = today.adding(days: 3)
        func rule(_ id: String, _ kind: EntryKind, _ category: String) -> RecurringRule {
            RecurringRule(
                id: id, title: id, kind: kind, total: 5_000, share: 5_000, categoryId: category, date: later,
                frequency: .monthly, nextDate: later, anchorDay: later.day)
        }
        let ledger = Ledger(
            transactions: [
                entry("lunch"),
                LedgerEntry(
                    id: "invoice", title: "Invoice", kind: .income, total: 60_000, share: 60_000,
                    categoryId: "salary", date: later),
            ], recurring: [rule("pay", .income, "salary"), rule("gym", .expense, "health")])
        let report = LedgerReport(ledger: ledger)
        let summary = report.month(MonthKey(today), today: today)
        let rows = report.monthEntries(summary)
        func row(_ id: String) throws -> ReportEntry { try #require(rows.first { $0.id == id }) }
        func meta(_ id: String) throws -> String {
            let entry = try row(id)
            let category = report.categories.first { $0.id == entry.categoryId }
            return EntryRow.meta(entry, category: category, report: report, today: today)
        }
        func parts(_ id: String) throws -> [String] { try meta(id).components(separatedBy: " · ") }
        func name(_ category: String) -> String { report.categories.first { $0.id == category }?.name ?? "?" }

        // Recorded: no status; a split share says "your share" instead of the category.
        #expect(try parts("lunch").dropFirst() == ["your share"])
        #expect(EntryRow.status(try row("lunch"), today: today) == nil)
        // Income dated after today, scheduled income, and a scheduled expense: one status each.
        #expect(try parts("invoice").dropFirst() == ["Expected", name("salary")])
        let pay = Recurrence.occurrenceID(ruleID: "pay", date: later)
        let gym = Recurrence.occurrenceID(ruleID: "gym", date: later)
        #expect(try parts(pay).dropFirst() == ["Expected", name("salary")])
        #expect(try parts(gym).dropFirst() == ["Scheduled", name("health")])
        for id in ["lunch", "invoice", pay, gym] {
            let text = try meta(id).lowercased()
            #expect(text.components(separatedBy: "expected").count <= 2, "\(id) says expected once")
            #expect(text.components(separatedBy: "scheduled").count <= 2, "\(id) says scheduled once")
        }
        // Waiting to sync replaces the meta line but keeps the status in words.
        #expect(EntryRow.waitingText(try row("lunch"), today: today) == "Waiting to sync")
        #expect(EntryRow.waitingText(try row("invoice"), today: today) == "Waiting to sync · Expected")
        #expect(EntryRow.waitingText(try row(gym), today: today) == "Waiting to sync · Scheduled")
        // On its date the income is recorded: no status.
        #expect(EntryRow.status(try row("invoice"), today: later) == nil)
    }

    @Test("whenIncomeIsDatedAfterToday_EntryRowAndForm_ShouldMarkItExpected")
    func futureIncomeIsExpected() throws {
        let tomorrow = today.adding(days: 1)
        let pay = LedgerEntry(
            id: "pay", title: "Pay", kind: .income, total: 200_000, share: 200_000, categoryId: "salary",
            date: tomorrow)
        let rent = LedgerEntry(
            id: "rent", title: "Rent", kind: .expense, total: 90_000, share: 90_000, categoryId: "home",
            date: tomorrow)
        let ledger = Ledger(transactions: [pay, rent])
        let rows = LedgerReport(ledger: ledger).recorded
        let income = try #require(rows.first { $0.id == "pay" })
        let expense = try #require(rows.first { $0.id == "rent" })
        // MAZ-136: income dated after today is expected (amber); a future expense is not (MAZ-139).
        #expect(EntryRow.meaning(income, today: today) == .pending)
        #expect(EntryRow.meaning(income, today: tomorrow) == .income, "on its date it is recorded")
        #expect(EntryRow.meaning(expense, today: today) == .expense)
        let note = EntryText.futureDate(.income, date: tomorrow, today: today)
        #expect(note.title == "Tomorrow is still ahead, so this pay shows as expected.")
        #expect(note.message == "It counts toward Projected until the day it's recorded — not toward Left to spend.")
        #expect(
            EntryText.futureDate(.expense, date: tomorrow, today: today).message.hasPrefix(
                "Penny records this entry now."))
    }
}
