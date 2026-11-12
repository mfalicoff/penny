import Foundation
import PennyData
import PennyDomain
import Testing

/// Review findings on PR #55 (MAZ-75): late answers, overlapping refreshes, saving once,
/// the payer's account, expired sessions and the invite countdown.
@Suite("Household review fixes (MAZ-75)")
@MainActor
struct HouseholdReviewTests {
    static let october = MonthKey(year: 2026, month: 10) ?? MonthKey(.earliest)
    static let september = MonthKey(year: 2026, month: 9) ?? MonthKey(.earliest)

    static func model(_ fake: FakeHouseholds) throws -> HouseholdModel {
        try #require(HouseholdModelTests.directory(fake).model(for: FakeHouseholds.home))
    }

    static func recap(_ month: String, balance: Int64) -> WireMonthRecap {
        WireMonthRecap(
            month: month, balances: [WireBalance(userId: FakeHouseholds.me, balanceCents: balance)],
            suggestions: [
                WireTransfer(fromUserId: FakeHouseholds.bea, toUserId: FakeHouseholds.me, amountCents: balance)
            ]
        )
    }

    @Test("whenMonthAnswersArriveOutOfOrder_HouseholdModel_ShouldKeepOnlyTheMonthOnScreen")
    func outOfOrderMonths() async throws {
        let fake = FakeHouseholds.standard()
        fake.state.withLock { state in
            state.recaps["\(FakeHouseholds.home) 2026-10"] = Self.recap("2026-10", balance: 1000)
            state.recaps["\(FakeHouseholds.home) 2026-09"] = Self.recap("2026-09", balance: 900)
        }
        let model = try Self.model(fake)
        await model.refresh()
        // October answers slowly; September (the second ‹) answers at once.
        fake.delay("monthRecap 2026-10", .milliseconds(300))
        async let toOctober: Void = model.show(month: Self.october, current: FakeHouseholds.november)
        while model.month != Self.october { try await Task.sleep(for: .milliseconds(5)) }
        await model.show(month: Self.september, current: FakeHouseholds.november)
        await toOctober
        #expect(model.month == Self.september)
        #expect(model.recap?.month == "2026-09", "October's late answer must not replace September's")
        #expect(model.viewerBalance == 900)
        #expect(model.recap?.suggestions.first?.amountCents == 900, "Record monthly uses September's suggestion")
    }

    @Test("whenARefreshAnswersAfterTheMonthChanged_HouseholdModel_ShouldDropItsRecap")
    func refreshThenMonthChange() async throws {
        let fake = FakeHouseholds.standard()
        fake.state.withLock { $0.recaps["\(FakeHouseholds.home) 2026-10"] = Self.recap("2026-10", balance: 1000) }
        let model = try Self.model(fake)
        fake.delay("monthRecap 2026-11", .milliseconds(300))
        async let refreshing: Void = model.refresh()
        while !fake.calls.contains("monthRecap") { try await Task.sleep(for: .milliseconds(5)) }
        await model.show(month: Self.october, current: FakeHouseholds.november)
        await refreshing
        #expect(model.recap?.month == "2026-10")
    }

    @Test("whenARefreshIsAskedForWhileOneRuns_HouseholdModel_ShouldReadAgainAfterIt")
    func queuedRefresh() async throws {
        let fake = FakeHouseholds.standard()
        let model = try Self.model(fake)
        fake.delay("household", .milliseconds(200))
        async let first: Void = model.refresh()
        while !fake.calls.contains("household") { try await Task.sleep(for: .milliseconds(5)) }
        // A save lands while the first read is in flight: its refresh must not be skipped.
        fake.state.withLock { state in state.households[0].name = "Apartment (renamed)" }
        await model.refresh()
        await first
        #expect(model.household?.name == "Apartment (renamed)", "the second caller waits for a read after its change")
        let reads = fake.calls.filter { $0 == "household" }.count
        #expect(reads == 2, "read \(reads) times: \(fake.calls)")
        #expect(model.load == .loaded)
    }

    @Test("whenASaveSucceeds_SharedExpenseForm_ShouldReturnAtOnceAndNeverSaveOrKeepItAgain")
    func saveOnce() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await SharedExpenseFormTests.open(fake)
        form.draft.amountText = "30"
        form.draft.title = "Pizza"
        // The page's refresh after the save is slow; the form must not wait for it.
        fake.delay("household", .seconds(2))
        let started = ContinuousClock.now
        let outcome = try #require(await form.save())
        #expect(ContinuousClock.now - started < .seconds(1), "Save returns before the page has read again")
        #expect(form.saved == outcome)
        // The sheet closing now (or a link replacing it) must not keep a draft of a created expense.
        form.keepDraft()
        #expect(form.household.directory?.drafts.isEmpty == true)
        #expect(await form.save() == outcome, "a second Save returns the first result")
        #expect(fake.calls.filter { $0 == "createSharedExpense" }.count == 1, "created once")
    }

    @Test("whenTheViewerPaysAgain_SharedExpenseDraft_ShouldRestoreTheirAccount")
    func accountComesBack() {
        let original = FakeHouseholds.expense("hydro")
        var withAccount = original
        withAccount.accountId = "my-visa"
        var draft = SharedExpenseDraft(editing: withAccount, viewerId: FakeHouseholds.me)
        let opened = draft
        #expect(draft.accountId == "my-visa")
        draft.choosePayer(FakeHouseholds.bea, viewerId: FakeHouseholds.me)
        #expect(draft.accountId == nil, "never sent for someone else's payment")
        draft.choosePayer(FakeHouseholds.cam, viewerId: FakeHouseholds.me)
        draft.choosePayer(FakeHouseholds.me, viewerId: FakeHouseholds.me)
        #expect(draft.accountId == "my-visa", "saving doesn't clear the link")
        #expect(draft == opened, "back where it started: nothing to save or discard")
    }

    @Test("whenTheServerEndsTheSession_HouseholdServices_ShouldReportItSoTheAppAsksToSignIn")
    func unauthorized() async throws {
        let ended = Counter()
        let transport = StubTransport(status: 401, json: #"{"error":"Unauthorized"}"#)
        let client = try APIFixtures.client(transport: transport)
        let households = APIHouseholdService(client: client) { ended.add() }
        await #expect(throws: APIError.unauthorized(message: "Unauthorized")) { _ = try await households.households() }
        await #expect(throws: APIError.unauthorized(message: "Unauthorized")) {
            _ = try await households.monthRecap(householdId: "h1", month: FakeHouseholds.november)
        }
        let projection = APISharedProjection(client: client) { ended.add() }
        await #expect(throws: APIError.unauthorized(message: "Unauthorized")) {
            _ = try await projection.projection(month: FakeHouseholds.november)
        }
        #expect(ended.value == 3)
        // Other failures leave the session alone.
        let offline = APIHouseholdService(
            client: try APIFixtures.client(transport: StubTransport { _ in throw URLError(.notConnectedToInternet) })
        ) { ended.add() }
        await #expect(throws: APIError.offline) { _ = try await offline.households() }
        #expect(ended.value == 3)
    }

    @Test("whenAnInviteTakesTimeToArrive_HouseholdModel_ShouldStartTheCountdownBeforeSending")
    func inviteStamp() async throws {
        let fake = FakeHouseholds.standard()
        let model = try Self.model(fake)
        await model.refresh()
        fake.delay("createInvite", .milliseconds(400))
        let before = Date()
        #expect(await model.newInvite() == nil)
        let expiry = try #require(model.inviteExpiresAt)
        #expect(expiry.timeIntervalSince(before) <= InviteCode.lifetime + 0.05)
        #expect(expiry.timeIntervalSince(before) < InviteCode.lifetime + 0.3, "stamped before the slow answer")
    }

    @Test("whenTheMonthRollsOver_HouseholdModel_ShouldOpenOnTheNewMonthUnlessChosenSince")
    func rollover() async throws {
        let fake = FakeHouseholds.standard()
        let model = try Self.model(fake)
        let december = try #require(MonthKey(year: 2026, month: 12))
        model.followCurrentMonth(FakeHouseholds.november)
        #expect(model.month == FakeHouseholds.november)
        model.followCurrentMonth(december)
        #expect(model.month == december, "reopened after the rollover: the new current month")
        // The person goes back to November in December; reopening in December keeps their choice.
        await model.show(month: FakeHouseholds.november, current: december)
        model.followCurrentMonth(december)
        #expect(model.month == FakeHouseholds.november)
        // A later rollover follows the calendar again.
        let january = try #require(MonthKey(year: 2027, month: 1))
        model.followCurrentMonth(january)
        #expect(model.month == january)
    }
}

/// Counts calls from a `@MainActor` closure.
@MainActor
final class Counter: Sendable {
    private(set) var value = 0
    func add() { value += 1 }
}
