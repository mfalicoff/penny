import Foundation
import PennyData
import PennyDesign
import PennyDomain

/// The iPad sidebar's Together section (`ipad-*` cards, MAZ-182; the web's `Sidebar.tsx`): each
/// household with your balance this month, then the trips happening now or coming next with
/// their start date. All households and All trips follow them (MAZ-240), so the Shared list
/// (join with a code, create another household) and every trip stay one tap away.
struct SidebarTogether: Equatable {
    struct Row: Equatable, Identifiable {
        let item: SidebarItem
        let name: String
        /// One short fact: the balance in whole units ("$142", "−$38") or the start date.
        let detail: String?
        /// What VoiceOver reads for `detail`, with the cents and the meaning in words.
        let spoken: String?

        var id: SidebarItem { item }
    }

    /// Trips listed by name; the rest are under All trips (as on the web).
    static let maxTrips = 3

    var households: [Row]
    var trips: [Row]

    init(
        households list: [WireHousehold], balances: [String: Int64], ledgerTrips: [Trip], today: CalendarDate,
        locale: Locale = .current
    ) {
        households = list.filter { $0.trip == nil }.map { household in
            let balance = balances[household.id]
            return Row(
                item: .household(id: household.id), name: household.name,
                detail: balance.map { Self.short($0, currency: household.currency, locale: locale) },
                spoken: balance.map { HouseholdText.balance($0, currency: household.currency) })
        }
        // A personal trip that was shared is listed once, as the shared trip.
        let shared = list.compactMap { household in household.tripRange.map { (household, $0) } }
        let sharedIDs = Set(shared.map(\.0.id))
        let personal = ledgerTrips.filter { trip in trip.sharedHouseholdId.map { !sharedIDs.contains($0) } ?? true }
        let all: [(id: String, name: String, range: TripRange)] =
            shared.map { (id: $0.0.id, name: $0.0.name, range: $0.1) }
            + personal.map { (id: $0.id, name: $0.name, range: TripRange($0)) }
        trips =
            all
            .filter { $0.range.phase(today: today) != .past }
            .sorted { ($0.range.start, $0.name) < ($1.range.start, $1.name) }
            .prefix(Self.maxTrips)
            .map { trip in
                let start = DayText.date(trip.range.start).formatted(
                    Date.FormatStyle(locale: locale).month(.abbreviated).day())
                return Row(item: .trip(id: trip.id), name: trip.name, detail: start, spoken: "starts \(start)")
            }
    }

    /// Households and All households share a glyph, as on the cards; so do trips and All trips.
    static let householdSymbol = "person.2"
    static let tripSymbol = "airplane"

    /// The row after the households, which opens the Shared list (join with a code, create
    /// another household): "All households", or "Shared" before you have one.
    var sharedTitle: String { households.isEmpty ? "Shared" : "All households" }

    /// The row after the trips, which opens the Trips list: "All trips", or "Trips" with none listed.
    var tripsTitle: String { trips.isEmpty ? "Trips" : "All trips" }

    /// Whole units with the typographic minus, as on the cards: "$142", "−$38".
    static func short(_ cents: Int64, currency: String, locale: Locale = .current) -> String {
        let value = Decimal(cents.magnitude / 100)
        let text = value.formatted(.currency(code: currency).locale(locale).precision(.fractionLength(0)))
        return cents <= -100 ? MoneyFormat.minus + text : text
    }
}
