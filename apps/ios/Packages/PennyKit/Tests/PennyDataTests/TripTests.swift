import Foundation
import PennyData
import PennyDomain
import Testing

/// Shared trips and the Trips tab's data (MAZ-76): the trip routes, the merged list that never
/// shows a trip twice, totals that never count an expense twice, Share trip with its undo, and
/// the trip form. Fixture ids and `.test` emails only.
enum TripFixtures {
    static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }
    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest)
    static let tripId = "trip-lisbon"

    static let personal = Trip(id: "mine", name: "Lisbon", startDate: day("2026-11-12"), endDate: day("2026-11-19"))

    static func sharedTrip(id: String = tripId, members: Int = 2) -> WireHousehold {
        WireHousehold(
            id: id, name: "Lisbon", currency: "CAD", creatorId: FakeHouseholds.me, createdAt: 1_793_000_000_000,
            memberCount: members, trip: WireHouseholdTrip(startDate: "2026-11-12", endDate: "2026-11-19"))
    }

    static func expense(_ id: String, trip: String? = "mine", date: String, share: Int64 = 2400) -> LedgerEntry {
        LedgerEntry(
            id: id, title: id, kind: .expense, total: share, share: share, categoryId: "transport", tripId: trip,
            date: day(date))
    }

    /// A fake server with the shared Lisbon trip (Alex organizes, Bea joined) and two expenses:
    /// one from before Cam joined (no share for Cam), one booked in October.
    static func server() -> FakeHouseholds {
        let fake = FakeHouseholds()
        fake.state.withLock { state in
            state.households = [sharedTrip(members: 3)]
            state.members[tripId] = [
                FakeHouseholds.member(FakeHouseholds.me), FakeHouseholds.member(FakeHouseholds.bea),
                FakeHouseholds.member(FakeHouseholds.cam, joinedOn: "2026-11-14"),
            ]
            var flight = FakeHouseholds.expense(
                "flight", total: 80_000, splits: [(FakeHouseholds.me, 40_000), (FakeHouseholds.bea, 40_000)],
                date: "2026-10-02")
            flight.householdId = tripId
            var dinner = FakeHouseholds.expense("dinner", total: 9000, payer: FakeHouseholds.bea, date: "2026-11-15")
            dinner.householdId = tripId
            state.expenses = ["flight": flight, "dinner": dinner]
        }
        return fake
    }

    @MainActor
    static func trips(_ fake: FakeHouseholds) -> TripDirectory {
        TripDirectory(
            households: HouseholdDirectory(
                service: fake, email: FakeHouseholds.email, month: { november }, timezoneOffset: { 300 }),
            timezoneOffset: { 300 })
    }
}

/// An in-memory ledger behind `TripCommit`, refusing what the shared rules refuse.
@MainActor
final class LedgerBox {
    var ledger: Ledger
    var summaries: [ChangeSummary] = []
    /// The next commit fails with this, once.
    var failNext: SaveFailure?

    init(_ ledger: Ledger) { self.ledger = ledger }

    var commit: TripCommit {
        { [self] change, summary in
            if let failure = failNext {
                failNext = nil
                return failure
            }
            do throws(LedgerRuleError) {
                ledger = try change.apply(to: ledger)
                summaries.append(summary)
                return nil
            } catch {
                return .rule(error)
            }
        }
    }
}

@Suite("Shared trip API client (MAZ-76)")
struct TripClientTests {
    static let tripJSON =
        #"{"household":{"id":"t 1","name":"Lisbon","currency":"CAD","creatorId":"user-alex","createdAt":1,"memberCount":1,"trip":{"startDate":"2026-11-12","endDate":"2026-11-19"}}}"#

    @Test("whenCreatingAndEditingASharedTrip_APIClient_ShouldUseTheTripRoutesAndBodies")
    func routes() async throws {
        let transport = StubTransport(status: 201, json: Self.tripJSON)
        let client = try APIFixtures.client(transport: transport)
        let created = try await client.createTrip(
            name: "  Lisbon ", currency: .cad, startDate: TripFixtures.day("2026-11-12"),
            endDate: TripFixtures.day("2026-11-19"), timezoneOffsetMinutes: 300)
        #expect(created.trip?.endDate == "2026-11-19")
        #expect(transport.sent[0].httpMethod == "POST")
        #expect(transport.sent[0].url?.path == "/api/households/trips")
        let body = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(body["name"] as? String == "Lisbon")
        #expect(body["currency"] as? String == "CAD")
        #expect(body["startDate"] as? String == "2026-11-12")
        #expect(body["endDate"] as? String == "2026-11-19")
        #expect(body["timezoneOffsetMinutes"] as? Int == 300)

        _ = try await client.updateTrip(
            id: "t 1", name: "Lisbon", startDate: TripFixtures.day("2026-11-13"),
            endDate: TripFixtures.day("2026-11-20"))
        #expect(transport.sent[1].httpMethod == "PATCH")
        #expect(transport.sent[1].url?.absoluteString == "https://penny.example.test/api/households/t%201/trip")
        let update = try APIFixtures.object(transport.sent[1].httpBody)
        #expect(update.keys.sorted() == ["endDate", "name", "startDate"], "TripUpdate has no currency")
    }

    @Test("whenTheDatesAreInvalid_APIClient_ShouldRefuseBeforeSending")
    func invalidDates() async throws {
        let transport = StubTransport(status: 201, json: Self.tripJSON)
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.invalidRequest(.invalidField("endDate"))) {
            _ = try await client.createTrip(
                name: "Lisbon", currency: .cad, startDate: TripFixtures.day("2026-11-12"),
                endDate: TripFixtures.day("2026-11-11"), timezoneOffsetMinutes: 0)
        }
        await #expect(throws: APIError.invalidRequest(.invalidField("startDate"))) {
            _ = try await client.updateTrip(
                id: "t", name: "Lisbon", startDate: TripFixtures.day("1999-12-31"),
                endDate: TripFixtures.day("2026-11-11"))
        }
        #expect(transport.sent.isEmpty)
    }

    @Test("whenTheServerAnswersAHouseholdWithoutDates_CreateTrip_ShouldRefuseTheAnswer")
    func malformed() async throws {
        let transport = StubTransport(
            status: 201,
            json:
                #"{"household":{"id":"h","name":"Lisbon","currency":"CAD","creatorId":"u","createdAt":1,"memberCount":1}}"#
        )
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.malformedResponse) {
            _ = try await client.createTrip(
                name: "Lisbon", currency: .cad, startDate: TripFixtures.day("2026-11-12"),
                endDate: TripFixtures.day("2026-11-12"), timezoneOffsetMinutes: 0)
        }
    }
}

@Suite("Trips list and totals (MAZ-76)")
struct TripListTests {
    @Test("whenAPersonalTripIsSharedAndVisible_TripList_ShouldShowItOnceAsTheSharedTrip")
    func folding() {
        var linked = TripFixtures.personal
        linked.sharedHouseholdId = TripFixtures.tripId
        let ski = Trip(
            id: "ski", name: "Ski week", startDate: TripFixtures.day("2027-02-14"),
            endDate: TripFixtures.day("2027-02-21"))
        let ledger = Ledger(
            trips: [linked, ski],
            transactions: [
                TripFixtures.expense("train", date: "2026-09-28"),
                TripFixtures.expense("pass", trip: "ski", date: "2027-01-02"),
            ])
        let cards = TripList.cards(ledger: ledger, households: [TripFixtures.sharedTrip()])
        #expect(cards.map(\.id) == ["ski", TripFixtures.tripId], "newest start first; the linked trip once")
        guard case .shared(_, let folded) = cards[1].kind else {
            Issue.record("expected the shared trip")
            return
        }
        #expect(folded.map(\.id) == ["mine"])
        guard case .personal(_, let total, let count, let wasShared) = cards[0].kind else {
            Issue.record("expected the personal trip")
            return
        }
        #expect(total == 2400 && count == 1 && !wasShared)
    }

    @Test("whenTheSharedTripIsGoneOrUnknown_TripList_ShouldShowThePersonalTripAgain")
    func wasShared() {
        var linked = TripFixtures.personal
        linked.sharedHouseholdId = "archived-trip"
        let ledger = Ledger(trips: [linked])
        let gone = TripList.cards(ledger: ledger, households: [])
        guard case .personal(_, _, _, let wasShared) = gone.first?.kind else {
            Issue.record("expected the personal trip")
            return
        }
        #expect(wasShared, "archived or left: it stands on its own, marked as once shared")
        let unknown = TripList.cards(ledger: ledger, households: nil)
        guard case .personal(_, _, _, let unchecked) = unknown.first?.kind else {
            Issue.record("expected the personal trip")
            return
        }
        #expect(!unchecked, "without the household list a link can't be checked")
    }

    @Test("whenTripsHappenNowOrLater_Featured_ShouldPickTheCurrentThenTheNextOne")
    func featured() {
        let past = Trip(
            id: "past", name: "A", startDate: TripFixtures.day("2026-08-01"), endDate: TripFixtures.day("2026-08-03"))
        let next = Trip(
            id: "next", name: "B", startDate: TripFixtures.day("2026-12-01"), endDate: TripFixtures.day("2026-12-03"))
        let later = Trip(
            id: "later", name: "C", startDate: TripFixtures.day("2027-01-01"), endDate: TripFixtures.day("2027-01-03"))
        let cards = TripList.cards(ledger: Ledger(trips: [past, next, later]), households: [TripFixtures.sharedTrip()])
        #expect(TripList.featured(cards, today: TripFixtures.day("2026-11-14"))?.id == TripFixtures.tripId)
        #expect(TripList.featured(cards, today: TripFixtures.day("2026-11-25"))?.id == "next")
        #expect(TripList.featured(cards, today: TripFixtures.day("2027-02-01")) == nil)
    }

    @Test("whenPrivateAndSharedExpensesMix_SharedTripTotals_ShouldCountEachOnce")
    func totals() {
        let range = TripRange(start: TripFixtures.day("2026-11-12"), end: TripFixtures.day("2026-11-19"))
        let fake = TripFixtures.server()
        let shared = fake.state.withLock { Array($0.expenses.values) }
        let mine = [TripFixtures.expense("train", date: "2026-09-28")]
        let totals = SharedTripTotals(expenses: shared, meId: FakeHouseholds.me, personal: mine, range: range)
        #expect(totals.tripTotal == 89_000, "the group's spending: shared expenses only")
        #expect(totals.sharedShare == 43_000, "40,000 of the flight and a third of dinner")
        #expect(totals.privateShare == 2400)
        #expect(totals.yourSpending == 45_400)
        #expect(totals.outside == 2, "the October flight and the September train")

        let late = SharedTripTotals(expenses: shared, meId: FakeHouseholds.cam, personal: [], range: range)
        #expect(late.sharedShare == 3000, "someone who joined later has no share of earlier expenses")
        let stranger = SharedTripTotals(expenses: shared, meId: nil, personal: [], range: range)
        #expect(stranger.sharedShare == 0 && stranger.tripTotal == 89_000)
    }
}

@Suite("Shared trips and the trip form (MAZ-76)")
@MainActor
struct TripModelTests {
    @Test("whenSharingAPersonalTrip_TripDirectory_ShouldCreateLinkAndNeverSendItsExpenses")
    func share() async {
        let fake = FakeHouseholds()
        let trips = TripFixtures.trips(fake)
        let box = LedgerBox(
            Ledger(trips: [TripFixtures.personal], transactions: [TripFixtures.expense("train", date: "2026-09-28")]))
        let outcome = await trips.share(TripFixtures.personal, currency: .cad, commit: box.commit)
        guard case .shared(let household) = outcome else {
            Issue.record("expected shared, got \(outcome)")
            return
        }
        #expect(household.trip == WireHouseholdTrip(startDate: "2026-11-12", endDate: "2026-11-19"))
        #expect(box.ledger.trip(id: "mine")?.sharedHouseholdId == household.id)
        #expect(box.ledger.transactions.first?.tripId == "mine", "the earlier expense stays on the personal trip")
        #expect(fake.calls == ["createTrip"], "no expense is sent to the shared trip")
        #expect(trips.households.households.first?.id == household.id)
        #expect(box.ledger.privateExpenses(linkedTo: household.id).map(\.id) == ["train"])
    }

    @Test("whenTheLinkCantBeSaved_Share_ShouldArchiveTheNewTripAgain")
    func shareUndone() async {
        let fake = FakeHouseholds()
        let trips = TripFixtures.trips(fake)
        let box = LedgerBox(Ledger(trips: [TripFixtures.personal]))
        box.failNext = .storage("The disk is full.")
        let outcome = await trips.share(TripFixtures.personal, currency: .cad, commit: box.commit)
        #expect(outcome == .undone(.storage("The disk is full.")))
        #expect(fake.calls == ["createTrip", "archiveHousehold"])
        #expect(box.ledger.trip(id: "mine")?.sharedHouseholdId == nil)
        #expect(!trips.households.households.contains { $0.trip != nil }, "nothing is left half done")
    }

    @Test("whenTheLinkAndTheUndoBothFail_Share_ShouldSayTheTripWasLeftBehind")
    func shareLeftBehind() async {
        let fake = FakeHouseholds()
        fake.fail("archiveHousehold", with: .offline)
        let trips = TripFixtures.trips(fake)
        let box = LedgerBox(Ledger(trips: [TripFixtures.personal]))
        box.failNext = .storage("The disk is full.")
        let outcome = await trips.share(TripFixtures.personal, currency: .cad, commit: box.commit)
        guard case .leftBehind(let household, _) = outcome else {
            Issue.record("expected leftBehind, got \(outcome)")
            return
        }
        #expect(trips.households.isListed(household.id), "listed so the person can archive it")
    }

    @Test("whenTheServerRefusesOrIsOffline_Share_ShouldChangeNothing")
    func shareRefused() async {
        let fake = FakeHouseholds()
        fake.fail("createTrip", with: .badRequest(message: "Trip currency must match your ledger currency."))
        let trips = TripFixtures.trips(fake)
        let box = LedgerBox(Ledger(trips: [TripFixtures.personal]))
        let outcome = await trips.share(TripFixtures.personal, currency: .usd, commit: box.commit)
        #expect(outcome == .refused(HouseholdFailure(.invalid, "Trip currency must match your ledger currency.")))
        #expect(box.ledger.trip(id: "mine") == TripFixtures.personal)
        fake.fail("createTrip", with: .offline)
        let offline = await trips.share(TripFixtures.personal, currency: .cad, commit: box.commit)
        #expect(offline == .refused(HouseholdFailure(.offline, HouseholdFailure.offlineMessage)))
        var already = TripFixtures.personal
        already.sharedHouseholdId = "x"
        guard case .refused = await trips.share(already, currency: .cad, commit: box.commit) else {
            Issue.record("a shared trip can't be shared again")
            return
        }
    }

    @Test("whenTheOrganizerEditsTheDates_UpdateShared_ShouldKeepEveryExpense")
    func updateShared() async throws {
        let fake = TripFixtures.server()
        let trips = TripFixtures.trips(fake)
        let draft = TripDraft(
            name: "Lisbon and Porto", startDate: TripFixtures.day("2026-11-10"),
            endDate: TripFixtures.day("2026-11-22"))
        let updated = try await trips.updateShared(id: TripFixtures.tripId, draft).get()
        #expect(updated.name == "Lisbon and Porto")
        #expect(updated.trip?.startDate == "2026-11-10")
        let expenses = try #require(trips.expenses(for: TripFixtures.tripId))
        await expenses.refresh()
        #expect(expenses.expenses.map(\.id) == ["dinner", "flight"], "dates never move an expense; newest first")
        fake.fail("updateTrip", with: .forbidden(message: "Only the household creator can manage members."))
        let refused = await trips.updateShared(id: TripFixtures.tripId, draft)
        #expect(refused == .failure(HouseholdFailure(.restricted, "Only the household creator can manage members.")))
    }

    @Test("whenCreatingAPersonalTrip_TripFormModel_ShouldSaveOnceAndPointAtADuplicateName")
    func personalForm() async {
        let box = LedgerBox(Ledger(trips: [TripFixtures.personal]))
        let form = TripFormModel(target: .new, today: TripFixtures.day("2026-12-01"), makeID: { "new-trip" })
        form.draft.name = "  "
        #expect(await form.save(commit: box.commit, trips: nil, currency: .cad) == nil)
        #expect(form.problems[.name] != nil)
        form.draft.name = "lisbon"
        #expect(form.problems[.name] == nil, "changing the field clears its problem")
        #expect(await form.save(commit: box.commit, trips: nil, currency: .cad) == nil)
        #expect(form.problems[.name] == "You already have a trip with this name.")
        form.draft.name = " Ski week "
        form.draft.endDate = TripFixtures.day("2026-11-30")
        #expect(await form.save(commit: box.commit, trips: nil, currency: .cad) == nil)
        #expect(form.problems[.endDate] != nil)
        form.draft.endDate = TripFixtures.day("2026-12-07")
        let saved = await form.save(commit: box.commit, trips: nil, currency: .cad)
        #expect(
            saved
                == .personal(
                    Trip(
                        id: "new-trip", name: "Ski week", startDate: TripFixtures.day("2026-12-01"),
                        endDate: TripFixtures.day("2026-12-07"))))
        #expect(box.ledger.trips.count == 2)
        #expect(box.summaries.last?.title == "Trip added")
    }

    @Test("whenATripHasExpenses_TripFormModel_ShouldRefuseDeleteAndKeepTheLink")
    func deleteAndLink() async {
        var linked = TripFixtures.personal
        linked.sharedHouseholdId = "gone-trip"
        let box = LedgerBox(Ledger(trips: [linked], transactions: [TripFixtures.expense("train", date: "2026-09-28")]))
        let form = TripFormModel(target: .personal(linked), today: TripFixtures.day("2026-12-01"))
        #expect(TripFormModel.deleteNote(expenseCount: 1)?.hasPrefix("1 entry is") == true)
        #expect(TripFormModel.deleteNote(expenseCount: 0) == nil)
        #expect(await form.delete(commit: box.commit) == nil)
        #expect(form.failure == LedgerRuleError.tripHasEntries.message)
        form.draft.name = "Lisbon 2026"
        guard case .personal(let saved) = await form.save(commit: box.commit, trips: nil, currency: .cad) else {
            Issue.record("expected a saved personal trip")
            return
        }
        #expect(saved.sharedHouseholdId == "gone-trip", "editing never clears the private link")
        let empty = LedgerBox(Ledger(trips: [TripFixtures.personal]))
        let removable = TripFormModel(target: .personal(TripFixtures.personal), today: TripFixtures.day("2026-12-01"))
        #expect(await removable.delete(commit: empty.commit) == .deleted(TripFixtures.personal))
        #expect(empty.ledger.trips.isEmpty)
    }

    @Test("whenShareWithOthersIsOn_TripFormModel_ShouldCreateASharedTripOnlineOnly")
    func sharedForm() async {
        let fake = FakeHouseholds()
        let trips = TripFixtures.trips(fake)
        let box = LedgerBox(Ledger())
        let form = TripFormModel(target: .new, today: TripFixtures.day("2026-11-12"))
        form.draft.name = "Cottage"
        form.share = true
        #expect(form.saveTitle == "Create shared trip")
        fake.fail("createTrip", with: .offline)
        #expect(await form.save(commit: box.commit, trips: trips, currency: .cad) == nil)
        #expect(form.failure == HouseholdFailure.offlineMessage)
        #expect(form.draft.name == "Cottage", "the draft stays as typed")
        guard case .shared(let household) = await form.save(commit: box.commit, trips: trips, currency: .cad) else {
            Issue.record("expected a shared trip")
            return
        }
        #expect(household.trip?.startDate == "2026-11-12")
        #expect(box.ledger.trips.isEmpty, "a shared trip is not a personal ledger trip")
        let demo = TripFormModel(target: .new, today: TripFixtures.day("2026-11-12"))
        demo.draft.name = "Cottage"
        demo.share = true
        #expect(await demo.save(commit: box.commit, trips: nil, currency: .cad) == nil)
        #expect(demo.failure != nil)
    }

    @Test("whenReadsOverlapOrFail_SharedTripExpenses_ShouldKeepTheLatestList")
    func staleRead() async throws {
        let fake = TripFixtures.server()
        let trips = TripFixtures.trips(fake)
        let expenses = try #require(trips.expenses(for: TripFixtures.tripId))
        #expect(trips.expenses(for: TripFixtures.tripId) === expenses, "one model per trip")
        fake.delay("sharedExpenses", .milliseconds(200))
        async let slow: Void = expenses.refresh()
        try await Task.sleep(for: .milliseconds(20))
        fake.delay("sharedExpenses", .zero)
        fake.state.withLock { $0.expenses["flight"] = nil }
        await expenses.refresh()
        await slow
        #expect(expenses.expenses.map(\.id) == ["dinner"])
        #expect(expenses.load == .loaded)
        fake.fail("sharedExpenses", with: .offline)
        await expenses.refresh()
        #expect(expenses.load.failure?.kind == .offline)
        #expect(expenses.expenses.map(\.id) == ["dinner"], "a failure keeps what was read")
    }

    @Test("whenATripIsPendingAdd_TripDirectory_ShouldHandItOutOnce")
    func pendingAdd() {
        let trips = TripFixtures.trips(FakeHouseholds())
        trips.pendingAdd = "a"
        #expect(!trips.takePendingAdd(for: "b"))
        #expect(trips.takePendingAdd(for: "a"))
        #expect(!trips.takePendingAdd(for: "a"))
    }
}
