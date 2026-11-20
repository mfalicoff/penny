import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyUI

/// The iPad layouts of the redesign cards (MAZ-182): the sidebar's Together rows, and when
/// Activity, a household or trip, Settings and Add entry show two columns.
@Suite("iPad layouts (MAZ-182)")
@MainActor
struct IPadLayoutTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest
    private let english = Locale(identifier: "en_CA")

    private func household(_ id: String, _ name: String, trip: (String, String)? = nil) -> WireHousehold {
        WireHousehold(
            id: id, name: name, currency: "CAD", creatorId: "u-me", createdAt: 0, memberCount: 3,
            trip: trip.map { WireHouseholdTrip(startDate: $0.0, endDate: $0.1) })
    }

    private func day(_ year: Int, _ month: Int, _ day: Int) -> CalendarDate {
        CalendarDate(year: year, month: month, day: day) ?? .earliest
    }

    @Test("whenThereAreHouseholds_SidebarTogether_ShouldListEachWithItsWholeBalance")
    func householdRows() {
        let together = SidebarTogether(
            households: [household("h-flat", "Apartment"), household("h-cabin", "Cabin"), household("h-new", "New")],
            balances: ["h-flat": 14_250, "h-cabin": -3_820], ledgerTrips: [], today: today, locale: english)
        #expect(
            together.households.map(\.item) == [
                .household(id: "h-flat"), .household(id: "h-cabin"), .household(id: "h-new"),
            ])
        #expect(
            together.households.map(\.detail) == ["$142", "\u{2212}$38", nil], "no balance when it couldn't be read")
        #expect(together.households[0].spoken?.contains("142.50") == true, "VoiceOver keeps the cents")
    }

    @Test("whenThereAreTrips_SidebarTogether_ShouldListCurrentAndComingTripsByStartDate")
    func tripRows() {
        let together = SidebarTogether(
            households: [
                household("t-lisbon", "Lisbon", trip: ("2026-11-12", "2026-11-19")),
                household("t-past", "Austin", trip: ("2026-10-01", "2026-10-05")),
            ],
            balances: [:],
            ledgerTrips: [
                Trip(id: "p-ski", name: "Ski", startDate: day(2027, 1, 10), endDate: day(2027, 1, 14)),
                Trip(id: "p-now", name: "Montréal", startDate: day(2026, 11, 8), endDate: day(2026, 11, 10)),
                Trip(id: "p-far", name: "Tokyo", startDate: day(2027, 4, 1), endDate: day(2027, 4, 9)),
                // Shared since: listed once, as the shared trip.
                Trip(
                    id: "p-lisbon", name: "Lisbon", startDate: day(2026, 11, 12), endDate: day(2026, 11, 19),
                    sharedHouseholdId: "t-lisbon"),
            ],
            today: today, locale: english)
        #expect(together.households.isEmpty, "a shared trip is not a household row")
        #expect(together.trips.map(\.item) == [.trip(id: "p-now"), .trip(id: "t-lisbon"), .trip(id: "p-ski")])
        #expect(together.trips.count == SidebarTogether.maxTrips, "the rest are under All trips")
        #expect(together.trips[1].detail == "Nov 12")
    }

    @Test("whenTheColumnIsNarrow_ActivitySplit_ShouldPushTheEntryInsteadOfCollapsingTheDetail")
    func activitySplit() {
        // Portrait with the sidebar beside it: too narrow for both, so the list pushes the entry.
        #expect(ActivityView.splitListWidth(for: 514) == nil)
        #expect(ActivityView.splitListWidth(for: 0) == nil)
        // Portrait with the sidebar hidden, and landscape: both fit, the detail keeps its width.
        let portrait = ActivityView.splitListWidth(for: 834)
        #expect(portrait.map { 834 - $0 >= ActivityView.minDetailWidth } == true)
        #expect(ActivityView.splitListWidth(for: 874) == 393)
        #expect(ActivityView.splitListWidth(for: 1366 - 320) == ActivityView.listWidth)
    }

    @Test("whenThePageIsWideEnough_IPadPages_ShouldShowTwoColumns")
    func twoColumns() {
        #expect(HouseholdPage.isTwoColumn(width: 874))
        #expect(!HouseholdPage.isTwoColumn(width: 514))
        #expect(HouseholdPage.sideWidth(for: 874) == 402)
        #expect(SettingsColumns.isTwoColumn(width: 874))
        #expect(!SettingsColumns.isTwoColumn(width: 600))
        #expect(SettingsColumns.listWidth(for: 1046) == 400)
    }

    @Test("whenChipsDontFitOnOneLine_ChipFlow_ShouldWrapThemOntoTheNextLine")
    func chipFlow() {
        let sizes = [CGSize(width: 180, height: 44), CGSize(width: 80, height: 44), CGSize(width: 120, height: 44)]
        let wrapped = ChipFlow.rows(sizes, width: 300, spacing: 8)
        #expect(wrapped.map(\.indices) == [[0, 1], [2]])
        #expect(wrapped.first?.width == 268)
        #expect(ChipFlow.rows(sizes, width: nil, spacing: 8).map(\.indices) == [[0, 1, 2]])
        #expect(
            ChipFlow.rows([CGSize(width: 400, height: 44)], width: 300, spacing: 8).count == 1,
            "a wide chip keeps its line")
    }
}
