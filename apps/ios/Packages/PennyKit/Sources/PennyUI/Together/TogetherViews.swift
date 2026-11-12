import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The Trips tab: personal trips with what was spent on each. Shared trips and editing arrive
/// with MAZ-76.
struct TripsView: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        WorkspaceContent { ledger in
            let report = LedgerReport(ledger: ledger)
            let totals = report.tripTotals
            List {
                Section {
                    SyncBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    DemoBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                .listSectionSeparator(.hidden)
                Section {
                    ForEach(Self.sorted(ledger.trips), id: \.id) { trip in
                        NavigationLink(value: DetailRoute.trip(id: trip.id)) {
                            TripRow(
                                trip: trip, total: totals[trip.id]?.total ?? 0, count: totals[trip.id]?.count ?? 0,
                                currency: ledger.currency.rawValue)
                        }
                        .accessibilityIdentifier("trip.\(trip.id)")
                    }
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.trips.isEmpty {
                    PennyStateView(
                        .empty, title: "No trips yet",
                        message: "Trips group what you spend while away, so you can see what a trip cost.")
                }
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Trips")
        .accessibilityIdentifier("screen.trips")
    }

    /// Newest start first, then name.
    static func sorted(_ trips: [Trip]) -> [Trip] {
        trips.sorted { $0.startDate != $1.startDate ? $0.startDate > $1.startDate : $0.name < $1.name }
    }
}

private struct TripRow: View {
    let trip: Trip
    let total: Int64
    let count: Int
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: "airplane", color: PennyColor.category(.home))
            VStack(alignment: .leading, spacing: 2) {
                Text(trip.name).font(.body.weight(.semibold))
                Text(
                    "\(DayText.date(trip.startDate).formatted(.dateTime.month(.abbreviated).day())) – "
                        + "\(DayText.date(trip.endDate).formatted(.dateTime.month(.abbreviated).day())) · "
                        + (count == 1 ? "1 expense" : "\(count) expenses")
                )
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            MoneyText(total, meaning: .neutral, currency: currency)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }
}

/// A personal trip and its expenses. A link to a trip this device doesn't have shows a named
/// state rather than an empty page.
struct TripDetailView: View {
    @Environment(ShellModel.self) private var shell
    let id: String

    var body: some View {
        WorkspaceContent { ledger in
            if let trip = ledger.trips.first(where: { $0.id == id }) {
                let report = LedgerReport(ledger: ledger)
                let summary = report.trip(trip)
                List {
                    Section {
                        HeroAmount("Spent on this trip", cents: summary.total, currency: ledger.currency.rawValue)
                            .listRowBackground(Color.clear)
                    }
                    Section("Expenses") {
                        let rows = summary.expenses.compactMap { expense in
                            report.recorded.first { $0.id == expense.id }
                        }
                        ForEach(rows) { entry in
                            EntryRow(entry: entry, report: report, currency: ledger.currency.rawValue)
                                .listRowInsets(EdgeInsets())
                        }
                    }
                }
                .insetGroupedList()
                .overlay {
                    if summary.expenses.isEmpty {
                        PennyStateView(.empty, title: "No expenses on this trip yet")
                    }
                }
                .navigationTitle(trip.name)
            } else {
                PennyStateView(
                    .error, title: "Trip not found",
                    message: "This trip isn't on this device. It may have been removed or belong to another account."
                )
                .navigationTitle("Trip")
            }
        }
        .background(PennyColor.background)
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.trip")
    }
}

extension View {
    func insetGroupedList() -> some View {
        #if os(iOS)
            listStyle(.insetGrouped).scrollContentBackground(.hidden)
        #else
            listStyle(.inset).scrollContentBackground(.hidden)
        #endif
    }
}
