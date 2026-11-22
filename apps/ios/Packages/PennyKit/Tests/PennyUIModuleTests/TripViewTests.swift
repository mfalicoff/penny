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
        #expect(TripRow.detail(personal, today: today) == "\(TripText.shortRange(range, today: today)) · was shared")
    }

    @Test("whenATripIsListed_ShortRange_ShouldReadAsTheCardsDoWithTheYearOnlyWhenItIsNotThisOne")
    func shortRange() {
        let english = Locale(identifier: "en_US")
        guard Locale.current.language.languageCode == english.language.languageCode else { return }
        let sameMonth = TripRange(start: day("2026-11-12"), end: day("2026-11-19"))
        #expect(TripText.shortRange(sameMonth, today: today) == "Nov 12–19")
        #expect(TripText.shortRange(sameMonth, today: today, year: true) == "Nov 12–19, 2026")
        let acrossMonths = TripRange(start: day("2026-10-30"), end: day("2026-11-02"))
        #expect(TripText.shortRange(acrossMonths, today: today) == "Oct 30 – Nov 2")
        let nextYear = TripRange(start: day("2027-02-14"), end: day("2027-02-21"))
        #expect(TripText.shortRange(nextYear, today: today) == "Feb 14–21, 2027")
        let oneDay = TripRange(start: day("2026-08-22"), end: day("2026-08-22"))
        #expect(TripText.shortRange(oneDay, today: today) == "Aug 22")
        let crossing = TripRange(start: day("2026-12-28"), end: day("2027-01-03"))
        #expect(TripText.shortRange(crossing, today: today) == "Dec 28, 2026 – Jan 3, 2027")
    }

    @Test("whenACountIsShown_TripText_ShouldSayPersonOrPeople")
    func people() {
        #expect(TripText.people(1) == "1 person")
        #expect(TripText.people(4) == "4 people")
    }
}
