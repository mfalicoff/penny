import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the trip screens MAZ-76 owns, named after their cards in docs/design/penny-ios
// and the redesign specimens the issue lists (`trips`, `personal-trip`, `shared-trip`,
// `trip-form`, `share-personal-trip`, `trip-people`, `trip-balances`). Made-up data and `.test`
// addresses only. Shared writes answer "offline".

@MainActor
private enum TripSpecimen {
    /// The demo ledger, plus a personal trip linked to the shared Lisbon trip with one private
    /// expense from before sharing (dated outside the trip).
    static func ledger() -> Ledger {
        var ledger = Specimen.ledger()
        let start = CalendarDate(year: 2026, month: 11, day: 12) ?? .earliest
        ledger.trips.append(
            Trip(
                id: "lisbon-mine", name: "Lisbon (mine)", startDate: start, endDate: start.adding(days: 7),
                sharedHouseholdId: PreviewHouseholds.lisbon.id))
        ledger.transactions.append(
            LedgerEntry(
                id: "airport-train", title: "Airport train", kind: .expense, total: 2_400, share: 2_400,
                categoryId: "transport", tripId: "lisbon-mine", date: start.adding(days: -45)))
        return ledger
    }

    static func shell() -> ShellModel {
        ShellModel(
            workspace: FixedWorkspace(load: .ready(ledger())), session: .demo, today: Specimen.today,
            households: PreviewHouseholds(), householdEmail: "max@example.test")
    }
}

#Preview("iphone-trips · trips") {
    let shell = TripSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { TripsView() } }
}

#Preview("iphone-trip-detail · personal-trip") {
    let shell = TripSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { TripDetailView(id: "demo-trip") } }
}

#Preview("iphone-trip-detail · shared-trip, trip-balances, trip-people") {
    // Balances and People are sections of the shared trip page.
    let shell = TripSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { TripDetailView(id: PreviewHouseholds.lisbon.id) } }
}

#Preview("iphone-trip-form · trip-form") {
    let shell = TripSpecimen.shell()
    SpecimenHost(shell: shell) { TripFormSheet(target: .new, expenseCount: 0) { _ in } }
}

#Preview("trip-form · edit with expenses") {
    let shell = TripSpecimen.shell()
    let trip = TripSpecimen.ledger().trips[0]
    SpecimenHost(shell: shell) { TripFormSheet(target: .personal(trip), expenseCount: 1) { _ in } }
}

#Preview("share-personal-trip") {
    let shell = TripSpecimen.shell()
    let trip = TripSpecimen.ledger().trips[0]
    SpecimenHost(shell: shell) { ShareTripSheet(trip: trip, expenseCount: 1, currency: .cad) { _ in } }
}

#Preview("ipad-trip") {
    let shell = TripSpecimen.shell()
    SpecimenHost(shell: shell) {
        NavigationSplitView {
            TripsView()
        } detail: {
            NavigationStack { TripDetailView(id: PreviewHouseholds.lisbon.id) }
        }
    }
}
