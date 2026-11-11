import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("Entry form saves (MAZ-73)")
@MainActor
struct EntryFormModelTests {
    static let today = PennyDomain.CalendarDate.day("2026-11-05")

    static func summary(_ entry: LedgerEntry, _ isNew: Bool) -> ChangeSummary {
        ChangeSummary(title: isNew ? "Expense added" : "Entry updated", detail: entry.title, kind: entry.kind)
    }

    /// A form over `workspace`, the way the shell wires it: its commit is the workspace's.
    static func form(_ workspace: any LedgerWorkspace, editor: EntryEditor) -> EntryFormModel {
        var next = 0
        return EntryFormModel(
            editor: editor,
            commit: { change, summary in
                if case .failure(let failure) = await workspace.commit(change, summary: summary) { return failure }
                return nil
            },
            makeID: {
                next += 1
                return "new-\(next)"
            })
    }

    static func newForm(_ workspace: any LedgerWorkspace) throws -> EntryFormModel {
        let ledger = try #require(workspace.load.ledger)
        let form = form(workspace, editor: EntryEditor(new: .expense, today: today, ledger: ledger))
        form.draft.amount = "12.80"
        form.draft.title = "Lunch"
        return form
    }

    @Test("whenTheDraftIsValid_EntryFormModel_ShouldSaveOnceAndFinish")
    func saves() async throws {
        let workspace = FixedWorkspace(load: .ready(Offline.ledger()))
        let form = try Self.newForm(workspace)
        let ledger = try #require(workspace.load.ledger)
        #expect(await form.save(in: ledger, summary: Self.summary))
        #expect(form.editor.isSaved)
        #expect(workspace.commits.map(\.title) == ["Expense added"])
        #expect(workspace.load.ledger?.entry(id: "new-1")?.total == 1280)
        #expect(!(await form.save(in: ledger, summary: Self.summary)), "a saved form never saves again")
        #expect(workspace.commits.count == 1)
    }

    @Test("whenSaveIsTappedTwiceWhileSaving_EntryFormModel_ShouldCommitOnce")
    func duplicateSubmit() async throws {
        let workspace = FixedWorkspace(load: .ready(Offline.ledger()))
        let gate = AsyncGate()
        var commits = 0
        let ledger = try #require(workspace.load.ledger)
        let form = EntryFormModel(
            editor: EntryEditor(new: .expense, today: Self.today, ledger: ledger),
            commit: { change, summary in
                commits += 1
                await gate.wait()
                if case .failure(let failure) = await workspace.commit(change, summary: summary) { return failure }
                return nil
            })
        form.draft.amount = "4"
        form.draft.title = "Coffee"
        let first = Task { await form.save(in: ledger, summary: Self.summary) }
        await eventually("first save running") { form.editor.isSaving }
        let second = await form.save(in: ledger, summary: Self.summary)
        await gate.open()
        #expect(await first.value)
        #expect(!second)
        #expect(commits == 1)
        #expect(workspace.load.ledger?.transactions.count == 1)
    }

    @Test("whenTheDraftIsRefused_EntryFormModel_ShouldNotCommitAndShouldKeepTheDraft")
    func refused() async throws {
        let workspace = FixedWorkspace(load: .ready(Offline.ledger()))
        let form = try Self.newForm(workspace)
        form.draft.amount = "0"
        let ledger = try #require(workspace.load.ledger)
        #expect(!(await form.save(in: ledger, summary: Self.summary)))
        #expect(form.editor.failure?.rule == .zeroAmount)
        #expect(form.refusedCount == 1)
        #expect(workspace.commits.isEmpty)
        #expect(form.draft.title == "Lunch")
    }

    @Test("whenTheSaveFails_EntryFormModel_ShouldKeepTheDraftAndSucceedOnRetry")
    func failedSaveRetry() async throws {
        let workspace = FixedWorkspace(
            load: .ready(Offline.ledger()), saveFailure: .storage("This device is out of space."))
        let form = try Self.newForm(workspace)
        let ledger = try #require(workspace.load.ledger)
        #expect(!(await form.save(in: ledger, summary: Self.summary)))
        #expect(form.editor.failure == EntrySaveFailure(message: "This device is out of space."))
        #expect(!form.editor.hasConflict)
        #expect(form.draft.amount == "12.80" && form.draft.title == "Lunch")
        workspace.saveFailure = nil
        #expect(await form.save(in: ledger, summary: Self.summary))
        #expect(workspace.load.ledger?.transactions.map(\.title) == ["Lunch"])
    }

    @Test("whenTheEntryChangedElsewhere_EntryFormModel_ShouldReportTheConflictAndReopenTheLatest")
    func staleEdit() async throws {
        let original = Offline.entry("lunch", title: "Lunch")
        let workspace = FixedWorkspace(load: .ready(Offline.ledger([original])))
        let form = Self.form(workspace, editor: EntryEditor(editing: original))
        form.draft.title = "Team lunch"
        var changed = original
        changed.note = "From the web"
        _ = await workspace.commit(.saveEntry(changed, original: original), summary: ChangeSummary(title: "web"))

        let ledger = try #require(workspace.load.ledger)
        #expect(!(await form.save(in: ledger, summary: Self.summary)))
        #expect(form.editor.hasConflict)
        #expect(form.editor.failure?.message.contains("changed on another device") == true)
        #expect(workspace.load.ledger?.entry(id: "lunch") == changed, "nothing was overwritten")

        #expect(form.reviewLatest(in: ledger))
        #expect(form.draft.note == "From the web" && form.draft.title == "Lunch")
        form.draft.title = "Team lunch"
        #expect(await form.save(in: ledger, summary: Self.summary))
        #expect(workspace.load.ledger?.entry(id: "lunch")?.title == "Team lunch")
        #expect(workspace.load.ledger?.entry(id: "lunch")?.note == "From the web")
    }

    @Test("whenTheEntryWasDeletedElsewhere_EntryFormModel_ShouldSayThereIsNothingToReview")
    func deletedElsewhere() async throws {
        let original = Offline.entry("lunch", title: "Lunch")
        let workspace = FixedWorkspace(load: .ready(Offline.ledger([original])))
        let form = Self.form(workspace, editor: EntryEditor(editing: original))
        form.draft.title = "Team lunch"
        _ = await workspace.commit(.deleteEntry(original), summary: ChangeSummary(title: "deleted"))
        let ledger = try #require(workspace.load.ledger)
        #expect(!(await form.save(in: ledger, summary: Self.summary)))
        #expect(form.editor.hasConflict)
        #expect(!form.reviewLatest(in: ledger))
        #expect(workspace.load.ledger?.transactions.isEmpty == true, "the deleted entry is not revived")
    }

    @Test("whenAnAccountIsCreatedInline_EntryFormModel_ShouldSaveWithItAndKeepTheDraft")
    func inlineAccount() async throws {
        let workspace = FixedWorkspace(load: .ready(Offline.ledger()))
        let form = try Self.newForm(workspace)
        form.draft.note = "Typed before creating the account"
        let card = PaymentAccount(id: "amex", name: "Amex", type: .credit)
        let added = await workspace.commit(.saveAccount(card), summary: ChangeSummary(title: "Account added"))
        #expect((try? added.get()) != nil)
        form.draft.accountId = card.id
        let ledger = try #require(workspace.load.ledger)
        #expect(await form.save(in: ledger, summary: Self.summary))
        let saved = try #require(workspace.load.ledger?.entry(id: "new-1"))
        #expect(saved.accountId == "amex" && saved.note == "Typed before creating the account")
    }

    @Test("whenTheAccountWasRemovedElsewhere_EntryFormModel_ShouldNameTheNextStep")
    func removedAccount() async throws {
        let workspace = FixedWorkspace(load: .ready(Offline.ledger()))
        let form = try Self.newForm(workspace)
        form.draft.accountId = "visa"
        _ = await workspace.commit(
            .saveAccount(PaymentAccount(id: "visa", name: "Visa", type: .credit), remove: true),
            summary: ChangeSummary(title: "removed"))
        let ledger = try #require(workspace.load.ledger)
        #expect(!(await form.save(in: ledger, summary: Self.summary)))
        #expect(form.editor.failure?.rule == .accountRemoved)
        #expect(!form.editor.hasConflict)
    }
}

@Suite("Entry form offline save (MAZ-73)")
@MainActor
struct EntryFormOfflineTests {
    let harness = SyncHarness()

    init() {
        harness.server.addAccount(Offline.alex, ledger: Offline.ledger([Offline.entry("lunch", title: "Lunch")]))
    }

    @Test("whenOffline_EntryFormModel_ShouldSaveOnThisDeviceAndSyncWhenBackOnline")
    func offlineSave() async throws {
        try await harness.signIn()
        await harness.waitFor(.upToDate, "first download")
        let workspace = AccountWorkspace(model: harness.model, scope: Offline.scope())
        await harness.goOffline()
        let form = try EntryFormModelTests.newForm(workspace)
        form.draft.title = "Taxi to airport"
        let ledger = try #require(workspace.load.ledger)
        #expect(await form.save(in: ledger, summary: EntryFormModelTests.summary))
        let id = try #require(workspace.load.ledger?.transactions.first { $0.title == "Taxi to airport" }?.id)
        #expect(workspace.pendingEntryIDs.contains(id))
        #expect(workspace.sync.pending == 1)
        #expect(harness.model.localSearch("taxi").map(\.id) == [id], "local search finds the unsynced entry")

        harness.goOnline()
        await harness.waitFor(.upToDate, "synced")
        #expect(harness.server.ledger(Offline.alex)?.entry(id: id)?.title == "Taxi to airport")
    }
}
