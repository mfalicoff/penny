import Foundation
import PennyData
import PennyDomain
import SwiftUI
import Testing

@testable import PennyUI

@Suite("Trip screens (MAZ-76)")
@MainActor
struct TripViewTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    private func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }

    @Test("whenTripExpenseIsChosen_ShellModel_ShouldOpenAddEntryOnThatTrip")
    func tripExpense() {
        let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
        shell.openTripExpense("demo-trip")
        #expect(shell.route.isAddEntryPresented)
        #expect(shell.addEntryTripId == "demo-trip")
    }

    @Test("whenNoServerIsAvailable_TripDirectory_ShouldOfferNoSharedTrips")
    func demo() {
        let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())), demo: true)
        #expect(!shell.trips.isAvailable)
        #expect(shell.trips.expenses(for: "anything") == nil)
    }

    @Test("whenATripIsShown_TripText_ShouldSayItsDatesAndWhatItIsInWords")
    func text() {
        let range = TripRange(start: day("2026-11-12"), end: day("2026-11-19"))
        let label = TripText.range(range)
        #expect(label.contains("2026"))
        #expect(label.components(separatedBy: "2026").count == 2, "the year once within one year")
        let crossing = TripRange(start: day("2026-12-28"), end: day("2027-01-03"))
        #expect(TripText.range(crossing).contains("2026") && TripText.range(crossing).contains("2027"))
        #expect(TripText.outside(1).hasPrefix("1 expense is"))
        let personal = TripCard(
            kind: .personal(
                Trip(id: "t", name: "Lisbon", startDate: range.start, endDate: range.end), total: 0, count: 2,
                wasShared: true), id: "t", name: "Lisbon", range: range)
        #expect(TripRow.detail(personal).hasSuffix("Personal · was shared · 2 expenses"))
    }
}
