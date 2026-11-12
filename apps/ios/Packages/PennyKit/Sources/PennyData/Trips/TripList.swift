import Foundation
public import PennyDomain

/// One row of the Trips tab (MAZ-76): a personal trip from the private ledger, or a shared trip
/// (a household with a travel range) from the server.
public struct TripCard: Identifiable, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// `total` is your share of its expenses. `wasShared`: it links to a shared trip the
        /// account can no longer see (archived, or left), so it stands on its own again.
        case personal(Trip, total: Int64, count: Int, wasShared: Bool)
        /// `linked`: your personal trips folded into it (their expenses show under Only you).
        case shared(WireHousehold, linked: [Trip])
    }

    public let kind: Kind
    /// The trip's id: a ledger trip id, or the household id. `penny://trips/<id>` takes either.
    public let id: String
    public let name: String
    public let range: TripRange

    public init(kind: Kind, id: String, name: String, range: TripRange) {
        self.kind = kind
        self.id = id
        self.name = name
        self.range = range
    }

    public var isShared: Bool {
        if case .shared = kind { return true }
        return false
    }
}

public enum TripList {
    /// Personal and shared trips as one list, newest start first, then name and id. A personal
    /// trip linked to a shared trip the account can still see is folded into that shared trip,
    /// so a trip never appears twice and its money is never counted twice. Without the
    /// household list (`households == nil`: offline before the first read, or the demo) a link
    /// can't be checked, so the personal trip shows without "was shared".
    public static func cards(ledger: Ledger?, households: [WireHousehold]?) -> [TripCard] {
        let shared = (households ?? []).compactMap { household -> (WireHousehold, TripRange)? in
            guard let range = household.tripRange else { return nil }
            return (household, range)
        }
        let sharedIds = Set(shared.map(\.0.id))
        let trips = ledger?.trips ?? []
        var totals: [String: (total: Int64, count: Int)] = [:]
        for entry in ledger?.transactions ?? [] where entry.kind == .expense {
            guard let tripId = entry.tripId else { continue }
            let current = totals[tripId] ?? (0, 0)
            totals[tripId] = (current.total + entry.share, current.count + 1)
        }
        let personal = trips.filter { trip in
            trip.sharedHouseholdId.map { !sharedIds.contains($0) } ?? true
        }
        .map { trip in
            TripCard(
                kind: .personal(
                    trip, total: totals[trip.id]?.total ?? 0, count: totals[trip.id]?.count ?? 0,
                    wasShared: trip.sharedHouseholdId != nil && households != nil),
                id: trip.id, name: trip.name, range: TripRange(trip))
        }
        let together = shared.map { household, range in
            TripCard(
                kind: .shared(household, linked: trips.filter { $0.sharedHouseholdId == household.id }),
                id: household.id, name: household.name, range: range)
        }
        return (together + personal).sorted { a, b in
            if a.range.start != b.range.start { return a.range.start > b.range.start }
            if a.name != b.name { return a.name.localizedStandardCompare(b.name) == .orderedAscending }
            return a.id < b.id
        }
    }

    /// The trip to feature at the top: one happening now (the one ending first), else the next
    /// one to start.
    public static func featured(_ cards: [TripCard], today: PennyDomain.CalendarDate) -> TripCard? {
        let now = cards.filter { $0.range.phase(today: today) == .now }
        if let first = now.min(by: { $0.range.end < $1.range.end }) { return first }
        return cards.filter { $0.range.phase(today: today) == .upcoming }.min { $0.range.start < $1.range.start }
    }
}

extension WireHousehold {
    /// The travel dates of a shared trip; nil for a household (or unreadable dates).
    public var tripRange: TripRange? {
        guard let trip, let start = PennyDomain.CalendarDate(trip.startDate),
            let end = PennyDomain.CalendarDate(trip.endDate)
        else {
            return nil
        }
        return TripRange(start: start, end: end)
    }
}

/// A shared trip's numbers (MAZ-76). Each expense counts once: private entries are personal
/// ledger rows, shared ones live on the server, and none is both.
public struct SharedTripTotals: Equatable, Sendable {
    /// What the group spent: the shared expenses' full amounts.
    public let tripTotal: Int64
    /// Your shares of the shared expenses.
    public let sharedShare: Int64
    /// Your private expenses on the personal trips linked to it (from before sharing).
    public let privateShare: Int64
    /// Expenses (shared and private) dated outside the travel dates. They still belong to it.
    public let outside: Int

    public var yourSpending: Int64 { sharedShare + privateShare }

    /// `personal` must already be in the trip's currency; pass none when it isn't (a total in
    /// two currencies can't be added up).
    public init(expenses: [WireSharedExpense], meId: String?, personal: [LedgerEntry], range: TripRange) {
        tripTotal = expenses.reduce(0) { $0 + $1.totalCents }
        sharedShare = expenses.reduce(0) { $0 + $1.share(of: meId) }
        privateShare = personal.reduce(0) { $0 + $1.share }
        let sharedDates = expenses.compactMap { PennyDomain.CalendarDate($0.date) }
        outside = range.outside(sharedDates + personal.map(\.date))
    }
}
