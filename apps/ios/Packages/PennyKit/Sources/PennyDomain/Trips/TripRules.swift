/// Trip rules the screens decide what to show with (MAZ-76; the browser's
/// `apps/web/src/features/trips/model.ts`). A personal trip is private ledger data saved with
/// `LedgerChange.saveTrip`; a shared trip is a household with a travel range on the server. These
/// rules only describe; `saveTrip`, `saveEntry` and the server still enforce every rule.
///
/// A trip is an assignment, not a date filter: an expense belongs to the trip it was assigned
/// to (or added on) whatever its date, so flights booked a month before count. Changing a
/// trip's dates never moves an expense, a share or a membership.

/// Where a trip is relative to today, on the person's own calendar.
public enum TripPhase: String, Hashable, Sendable {
    case upcoming, now, past
}

/// A trip's travel dates: both ends included.
public struct TripRange: Hashable, Sendable {
    public var start: CalendarDate
    public var end: CalendarDate

    public init(start: CalendarDate, end: CalendarDate) {
        self.start = start
        self.end = end
    }

    public init(_ trip: Trip) { self.init(start: trip.startDate, end: trip.endDate) }

    public func contains(_ date: CalendarDate) -> Bool { date >= start && date <= end }

    public func phase(today: CalendarDate) -> TripPhase {
        if today < start { return .upcoming }
        if today > end { return .past }
        return .now
    }

    /// "Now", "Past", "Tomorrow", "In 3 days" (up to 30) or "Upcoming": always words, never
    /// color alone.
    public func phaseLabel(today: CalendarDate) -> String {
        switch phase(today: today) {
        case .now: return "Now"
        case .past: return "Past"
        case .upcoming:
            let days = start.days(since: today)
            if days == 1 { return "Tomorrow" }
            return days <= 30 ? "In \(days) days" : "Upcoming"
        }
    }

    /// How many of `dates` fall outside the travel dates. They still belong to the trip.
    public func outside(_ dates: [CalendarDate]) -> Int { dates.filter { !contains($0) }.count }
}

/// What a trip form can point at a field for: the same rules as `saveTrip` and the server's trip
/// schema (a name of 1–80 UTF-16 units after JavaScript trimming, real days from 2000 to 2100,
/// the end on or after the start). A duplicate personal name is left to `saveTrip`, which knows
/// the ledger.
public struct TripDraft: Hashable, Sendable {
    public enum Field: String, CaseIterable, Hashable, Sendable {
        case name, startDate, endDate
    }

    public var name: String
    public var startDate: CalendarDate
    public var endDate: CalendarDate

    public init(name: String = "", startDate: CalendarDate, endDate: CalendarDate) {
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
    }

    public init(_ trip: Trip) { self.init(name: trip.name, startDate: trip.startDate, endDate: trip.endDate) }

    public var trimmedName: String { JavaScriptText.trim(name) }

    /// Each field's problem, in the order the form shows them.
    public var problems: [Field: String] {
        var found: [Field: String] = [:]
        if !(1...80).contains(JavaScriptText.length(trimmedName)) {
            found[.name] = "Give your trip a name of up to 80 characters."
        }
        if !startDate.isWithinLedgerRange { found[.startDate] = "Choose a start date from 2000 to 2100." }
        if !endDate.isWithinLedgerRange {
            found[.endDate] = "Choose an end date from 2000 to 2100."
        } else if found[.startDate] == nil, endDate < startDate {
            found[.endDate] = "The trip can't end before it starts."
        }
        return found
    }

    /// The first field with a problem, to move focus to.
    public var firstProblem: Field? { Field.allCases.first { problems[$0] != nil } }
}

extension Ledger {
    /// Personal trips linked to the shared trip `householdId` (`sharedHouseholdId`).
    public func trips(linkedTo householdId: String) -> [Trip] {
        trips.filter { $0.sharedHouseholdId == householdId }
    }

    /// Personal expenses on personal trips linked to the shared trip `householdId`: what was
    /// added before sharing. Private to the viewer: never sent to the shared trip, counted in
    /// the viewer's spending only. Newest first, then id.
    public func privateExpenses(linkedTo householdId: String) -> [LedgerEntry] {
        let linked = Set(trips(linkedTo: householdId).map(\.id))
        return transactions.filter { $0.kind == .expense && $0.tripId.map(linked.contains) == true }
            .sorted { $0.date != $1.date ? $0.date > $1.date : JavaScriptText.ordinalLess($0.id, $1.id) }
    }

    /// Expenses assigned to the trip `id`, the count Delete trip is refused for.
    public func expenseCount(onTrip id: String) -> Int {
        transactions.count(where: { $0.tripId == id })
    }
}
