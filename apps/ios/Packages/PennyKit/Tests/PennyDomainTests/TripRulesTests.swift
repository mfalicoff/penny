import PennyDomain
import Testing

/// Trip rules (MAZ-76): phases, travel dates that never filter, the form's field rules,
/// assignment, reassignment and deletion through `saveTrip`/`saveEntry`, private expenses from
/// before sharing, and Trip expense opening the entry form on its trip.
@Suite("Trip rules (MAZ-76)")
struct TripRulesTests {
    static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }

    static let lisbon = Trip(
        id: "lisbon", name: "Lisbon", startDate: day("2026-11-12"), endDate: day("2026-11-19"))

    static func expense(_ id: String, trip: String? = "lisbon", date: String, total: Int64 = 1000, share: Int64? = nil)
        -> LedgerEntry
    {
        LedgerEntry(
            id: id, title: id, kind: .expense, total: total, share: share ?? total, categoryId: "food", tripId: trip,
            date: day(date))
    }

    static func ledger(_ trips: [Trip] = [lisbon], _ entries: [LedgerEntry] = []) -> Ledger {
        Ledger(trips: trips, transactions: entries)
    }

    @Test("whenTodayMoves_TripPhase_ShouldBeUpcomingNowThenPastWithWords")
    func phases() {
        let range = TripRange(Self.lisbon)
        #expect(range.phase(today: Self.day("2026-11-11")) == .upcoming)
        #expect(range.phaseLabel(today: Self.day("2026-11-11")) == "Tomorrow")
        #expect(range.phaseLabel(today: Self.day("2026-11-09")) == "In 3 days")
        #expect(range.phaseLabel(today: Self.day("2026-09-01")) == "Upcoming")
        #expect(range.phase(today: Self.day("2026-11-12")) == .now, "the first day is during the trip")
        #expect(range.phase(today: Self.day("2026-11-19")) == .now, "so is the last")
        #expect(range.phaseLabel(today: Self.day("2026-11-20")) == "Past")
    }

    @Test("whenExpensesAreDatedOutsideTheTrip_TripRange_ShouldCountThemWithoutDroppingThem")
    func outside() {
        let range = TripRange(Self.lisbon)
        let dates = ["2026-10-02", "2026-11-12", "2026-11-19", "2026-11-25"].map(Self.day)
        #expect(range.outside(dates) == 2)
        let ledger = Self.ledger(
            [Self.lisbon], [Self.expense("flight", date: "2026-10-02"), Self.expense("dinner", date: "2026-11-14")])
        let summary = LedgerReport(ledger: ledger).trip(Self.lisbon)
        #expect(summary.expenses.map(\.id) == ["dinner", "flight"], "a trip is an assignment, not a date filter")
        #expect(summary.total == 2000)
    }

    @Test("whenTheFormHasProblems_TripDraft_ShouldNameEachField")
    func draftProblems() {
        var draft = TripDraft(name: "   ", startDate: Self.day("2026-11-12"), endDate: Self.day("2026-11-10"))
        #expect(draft.problems[.name] != nil)
        #expect(draft.problems[.endDate] == "The trip can't end before it starts.")
        #expect(draft.firstProblem == .name)
        draft.name = String(repeating: "a", count: 81)
        #expect(draft.problems[.name] != nil, "more than 80 characters")
        draft.name = "  Lisbon  "
        draft.endDate = Self.day("2026-11-12")
        #expect(draft.problems.isEmpty, "a one-day trip is fine")
        #expect(draft.trimmedName == "Lisbon")
        draft.startDate = Self.day("1999-12-31")
        #expect(draft.problems[.startDate] != nil, "before the ledger range")
    }

    @Test("whenExpensesMoveBetweenTrips_SaveEntry_ShouldAssignReassignAndRefuseRemovedTrips")
    func assignment() throws {
        let rome = Trip(id: "rome", name: "Rome", startDate: Self.day("2027-03-01"), endDate: Self.day("2027-03-05"))
        var ledger = Self.ledger([Self.lisbon, rome])
        let flight = Self.expense("flight", date: "2026-10-02")
        ledger = try LedgerChange.saveEntry(flight).apply(to: ledger)
        #expect(ledger.expenseCount(onTrip: "lisbon") == 1)
        var moved = flight
        moved.tripId = "rome"
        ledger = try LedgerChange.saveEntry(moved, original: flight).apply(to: ledger)
        #expect(ledger.expenseCount(onTrip: "lisbon") == 0)
        #expect(ledger.expenseCount(onTrip: "rome") == 1)
        var income = LedgerEntry(
            id: "pay", title: "Pay", kind: .income, total: 100, share: 100, categoryId: "food", tripId: "rome",
            date: Self.day("2026-11-01"))
        #expect(throws: LedgerRuleError.tripUnavailable, "only expenses take a trip") {
            try LedgerChange.saveEntry(income).apply(to: ledger)
        }
        income.kind = .expense
        income.tripId = "gone"
        #expect(throws: LedgerRuleError.tripUnavailable) { try LedgerChange.saveEntry(income).apply(to: ledger) }
    }

    @Test("whenDeletingATrip_SaveTrip_ShouldRefuseWhileExpensesAreOnItThenAllowOnceMoved")
    func deletion() throws {
        let flight = Self.expense("flight", date: "2026-10-02")
        var ledger = Self.ledger([Self.lisbon], [flight])
        #expect(throws: LedgerRuleError.tripHasEntries) {
            try LedgerChange.saveTrip(Self.lisbon, original: Self.lisbon, remove: true).apply(to: ledger)
        }
        var none = flight
        none.tripId = nil
        ledger = try LedgerChange.saveEntry(none, original: flight).apply(to: ledger)
        ledger = try LedgerChange.saveTrip(Self.lisbon, original: Self.lisbon, remove: true).apply(to: ledger)
        #expect(ledger.trips.isEmpty)
        #expect(ledger.transactions.map(\.id) == ["flight"], "the expense stays, on no trip")
    }

    @Test("whenTheDatesChange_SaveTrip_ShouldKeepEveryExpenseOnTheTripAndTheSharedLink")
    func datesNeverMoveExpenses() throws {
        var linked = Self.lisbon
        linked.sharedHouseholdId = "house-trip"
        let ledger = Self.ledger([linked], [Self.expense("flight", date: "2026-10-02")])
        var shorter = linked
        shorter.startDate = Self.day("2026-11-15")
        let next = try LedgerChange.saveTrip(shorter, original: linked).apply(to: ledger)
        #expect(next.transactions.first?.tripId == "lisbon")
        #expect(next.trip(id: "lisbon")?.sharedHouseholdId == "house-trip")
        #expect(throws: LedgerRuleError.duplicateTripName) {
            try LedgerChange.saveTrip(
                Trip(id: "other", name: "lisbon", startDate: Self.day("2027-01-01"), endDate: Self.day("2027-01-02"))
            )
            .apply(to: next)
        }
    }

    @Test("whenATripIsShared_PrivateExpenses_ShouldBeTheLinkedTripsExpensesOnly")
    func privateExpenses() {
        var linked = Self.lisbon
        linked.sharedHouseholdId = "house-trip"
        let other = Trip(id: "rome", name: "Rome", startDate: Self.day("2027-03-01"), endDate: Self.day("2027-03-05"))
        let ledger = Self.ledger(
            [linked, other],
            [
                Self.expense("train", date: "2026-09-28"), Self.expense("hotel", date: "2026-11-13"),
                Self.expense("pasta", trip: "rome", date: "2027-03-02"),
                Self.expense("untripped", trip: nil, date: "2026-11-13"),
            ])
        #expect(ledger.privateExpenses(linkedTo: "house-trip").map(\.id) == ["hotel", "train"])
        #expect(ledger.trips(linkedTo: "house-trip").map(\.id) == ["lisbon"])
        #expect(ledger.privateExpenses(linkedTo: "another").isEmpty)
    }

    @Test("whenTripExpenseOpensTheForm_EntryEditor_ShouldStartOnTheTripUntouched")
    func tripExpense() {
        let ledger = Self.ledger()
        var editor = EntryEditor(new: .income, today: Self.day("2026-11-12"), ledger: ledger)
        editor.start(onTrip: "lisbon", ledger: ledger)
        #expect(editor.draft.tripId == "lisbon")
        #expect(editor.draft.kind == .expense, "only expenses take a trip")
        #expect(!editor.isDirty, "closing it untouched asks nothing")
        var missing = EntryEditor(new: .expense, today: Self.day("2026-11-12"), ledger: ledger)
        missing.start(onTrip: "gone", ledger: ledger)
        #expect(missing.draft.tripId == nil, "a trip that isn't in the ledger is left alone")
        var editing = EntryEditor(editing: Self.expense("x", trip: nil, date: "2026-11-12"))
        editing.start(onTrip: "lisbon", ledger: ledger)
        #expect(editing.draft.tripId == nil, "an edit keeps its own trip")
    }
}
