import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `penny://trips/<id>` and a trip row (MAZ-76): a personal trip by its ledger id, else a shared
/// trip by its household id, as in the Expo app and the browser. A shared trip is the household
/// page in trip words (`HouseholdPage`): Expenses for the whole trip, Balances by month, People.
struct TripDetailView: View {
    @Environment(ShellModel.self) private var shell
    let id: String

    var body: some View {
        WorkspaceContent { ledger in
            if let trip = ledger.trip(id: id) {
                PersonalTripPage(trip: trip, ledger: ledger)
                    .accessibilityIdentifier("screen.trip")
            } else if let model = shell.households.model(for: id) {
                HouseholdPage(model: model, opensAsTrip: true)
                    .accessibilityIdentifier("screen.sharedTrip")
            } else {
                PennyStateView(
                    .error, title: "Trip not found",
                    message: "This trip isn't on this device. It may have been removed or belong to another account."
                )
                .navigationTitle("Trip")
                .accessibilityIdentifier("screen.trip")
            }
        }
        .background(PennyColor.background)
        .toolbarTitleDisplayModeInline()
    }
}

/// A personal trip (`personal-trip`, card `iphone-trip-detail`): when it is, your spending, its
/// expenses (dated before, during or after it; each opens the entry) and spending by category.
/// Trip expense opens Add entry on the trip; Share trip turns it into a shared trip; Edit trip
/// changes the name and dates or deletes an empty trip.
struct PersonalTripPage: View {
    @Environment(ShellModel.self) private var shell
    let trip: Trip
    let ledger: Ledger

    @State private var editing = false
    @State private var sharing = false
    /// What a sheet did, applied once it has gone.
    @State private var outcome: Outcome?

    enum Outcome: Equatable {
        case shared(String)
    }

    var body: some View {
        let report = shell.report(ledger)
        let summary = report.trip(trip)
        let range = TripRange(trip)
        let outside = range.outside(summary.expenses.map(\.date))
        let currency = ledger.currency.rawValue
        let sharedAs = trip.sharedHouseholdId.flatMap { id in
            shell.households.households.first { $0.id == id && $0.trip != nil }
        }
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Text(range.phaseLabel(today: shell.today))
                            .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.pending)
                            .accessibilityIdentifier("tripPage.phase")
                        Label(
                            trip.sharedHouseholdId != nil && sharedAs == nil ? "Personal · was shared" : "Personal",
                            systemImage: "lock"
                        )
                        .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    Text(TripText.range(range)).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityIdentifier("tripPage.dates")
                    HeroAmount("Your spending", cents: summary.total, currency: currency)
                        .accessibilityIdentifier("tripPage.yourSpending")
                    Text(countLine(summary, outside: outside, currency: currency))
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("tripPage.outside")
                    HStack(spacing: 12) {
                        PennyButton("Trip expense", systemImage: "plus") { shell.openTripExpense(trip.id) }
                            .accessibilityIdentifier("tripPage.addExpense")
                        if !shell.isDemo, shell.trips.isAvailable, trip.sharedHouseholdId == nil {
                            PennyButton("Share trip", systemImage: "person.badge.plus", role: .secondary) {
                                sharing = true
                            }
                            .accessibilityIdentifier("tripPage.share")
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            }
            .listSectionSeparator(.hidden)

            if let sharedAs {
                Section {
                    StatusBanner(
                        tone: .info, title: "Shared as \(sharedAs.name)",
                        message:
                            "These expenses are from before sharing. They stay private to you and count in your "
                            + "spending only."
                    )
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("tripPage.sharedAs")
                    NavigationLink(value: DetailRoute.trip(id: sharedAs.id)) {
                        Label("Open shared trip", systemImage: "person.2")
                    }
                    .accessibilityIdentifier("tripPage.openShared")
                }
            }

            Section {
                if summary.expenses.isEmpty {
                    Text(
                        "No expenses on this trip yet. Add one with Trip expense, or choose this trip under Receipt, "
                            + "repeat, trip when you add an expense. Expenses before or after the dates count too."
                    )
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                }
                ForEach(summary.expenses, id: \.id) { entry in
                    NavigationLink(value: DetailRoute.entry(id: entry.id)) {
                        TripEntryRow(entry: entry, ledger: ledger, range: range)
                    }
                    .accessibilityIdentifier("entry.\(entry.id)")
                }
            } header: {
                Text("Trip expenses")
            } footer: {
                Text(TripText.datesNote)
            }

            if !summary.spending.isEmpty {
                Section("By category") {
                    ForEach(summary.spending, id: \.category.id) { item in
                        HStack(spacing: 12) {
                            CategoryIcon(
                                symbol: CategoryStyle.symbol(forIonicon: item.category.icon),
                                color: PennyColor.category(item.category.paletteColor))
                            Text(item.category.name)
                            Spacer()
                            MoneyText(item.amount, meaning: .neutral, currency: currency)
                        }
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("tripPage.category.\(item.category.id)")
                    }
                }
            }
        }
        .insetGroupedList()
        .refreshable {
            await shell.workspace.reload()
            if trip.sharedHouseholdId != nil { await shell.households.refresh() }
        }
        .navigationTitle(trip.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit trip", systemImage: "pencil") { editing = true }
                    .accessibilityIdentifier("tripPage.edit")
            }
        }
        .task {
            if trip.sharedHouseholdId != nil, shell.households.households.isEmpty { await shell.households.refresh() }
        }
        .sheet(isPresented: $editing, onDismiss: applyOutcome) {
            TripFormSheet(target: .personal(trip), expenseCount: ledger.expenseCount(onTrip: trip.id)) { saved in
                // The trip is gone from the ledger: leave its page at once (the sheet goes with it).
                if case .deleted = saved { leave() }
            }
            .environment(shell)
        }
        .sheet(isPresented: $sharing, onDismiss: applyOutcome) {
            ShareTripSheet(trip: trip, expenseCount: summary.expenses.count, currency: ledger.currency) { household in
                outcome = .shared(household.id)
            }
            .environment(shell)
        }
    }

    private func countLine(_ summary: TripSummary, outside: Int, currency: String) -> String {
        var parts = [TripText.expenses(summary.expenses.count)]
        if outside > 0 { parts.append("\(outside) outside the trip dates") }
        if summary.receiptTotal != summary.total {
            parts.append(
                "receipts \(MoneyFormat.amount(summary.receiptTotal, currency: currency)); only your share counts")
        }
        return parts.joined(separator: " · ")
    }

    /// Leaves this trip's page in the tab that shows it.
    private func leave() {
        let tab = shell.route.tab
        var path = shell.route.path(for: tab)
        guard let index = path.lastIndex(of: .trip(id: trip.id)) else { return }
        path.removeSubrange(index...)
        shell.route.setPath(path, for: tab)
    }

    /// After Share trip's sheet has gone: this page is replaced by the shared trip's, so Back
    /// still leads to where the person came from.
    private func applyOutcome() {
        guard let outcome else { return }
        self.outcome = nil
        switch outcome {
        case .shared(let id):
            let tab = shell.route.tab
            var path = shell.route.path(for: tab)
            if let index = path.lastIndex(of: .trip(id: trip.id)) {
                path[index] = .trip(id: id)
            } else {
                path.append(.trip(id: id))
            }
            shell.route.setPath(path, for: tab)
        }
    }
}

/// A personal expense on a trip: its day, category, and "outside the trip dates" when it is;
/// your share, with the receipt total when the expense is split.
struct TripEntryRow: View {
    let entry: LedgerEntry
    let ledger: Ledger
    /// Nil for private expenses on a shared trip, where the dates are the shared trip's.
    let range: TripRange?

    var body: some View {
        let category = ledger.category(id: entry.categoryId)
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: CategoryStyle.symbol(forIonicon: category?.icon ?? "pricetag"),
                color: PennyColor.category(
                    category?.paletteColor ?? CategoryStyle.color(forCategoryID: entry.categoryId)))
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                Text(meta(category)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(entry.share, meaning: .expense, currency: ledger.currency.rawValue)
                if entry.share != entry.total {
                    Text("of \(MoneyFormat.amount(entry.total, currency: ledger.currency.rawValue))")
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
        }
        .frame(minHeight: ControlSize.row)
        .accessibilityElement(children: .combine)
    }

    private func meta(_ category: LedgerCategory?) -> String {
        var parts = [DayText.date(entry.date).formatted(.dateTime.month(.abbreviated).day())]
        if let account = entry.accountId.flatMap(ledger.account(id:)) { parts.append(account.name) }
        parts.append(category?.name ?? "Unknown category")
        if let range, !range.contains(entry.date) { parts.append("outside the trip dates") }
        return parts.joined(separator: " · ")
    }
}
