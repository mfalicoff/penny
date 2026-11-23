import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `penny://trips/<id>` and a trip row (MAZ-76): a personal trip by its ledger id, else a shared
/// trip by its household id, as in the browser. A shared trip is the household
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
            // `iphone-trip-personal`: when, the name, the dates with the Personal chip, your
            // spending and how many expenses are dated outside the trip, then Trip expense and
            // Share trip, centered over the trips' glow.
            Section {
                VStack(spacing: 0) {
                    Text(range.phaseLabel(today: shell.today).uppercased())
                        .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityIdentifier("tripPage.phase")
                    Text(trip.name).font(.title.weight(.bold))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                        .accessibilityAddTraits(.isHeader)
                    HStack(spacing: 8) {
                        Text(TripText.shortRange(range, today: shell.today))
                            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        Label(
                            trip.sharedHouseholdId != nil && sharedAs == nil ? "Personal · was shared" : "Personal",
                            systemImage: "lock"
                        )
                        .labelStyle(TripChipLabelStyle())
                    }
                    .padding(.top, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("tripPage.dates")
                    VStack(spacing: 4) {
                        Text(MoneyFormat.amount(summary.total, currency: currency))
                            .modifier(HeroAmountFont())
                            .foregroundStyle(PennyColor.label)
                            .lineLimit(1)
                            .minimumScaleFactor(0.4)
                        Text("Your spending").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .padding(.top, 10)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("tripPage.yourSpending")
                    if outside > 0 {
                        Label("\(outside) outside the trip dates", systemImage: "calendar")
                            .font(.footnote.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                            .labelStyle(TripChipLabelStyle(chip: false))
                            .padding(.top, 8)
                            .accessibilityIdentifier("tripPage.outside")
                    }
                    HStack(spacing: 10) {
                        PennyButton("Trip expense", systemImage: "plus") { shell.openTripExpense(trip.id) }
                            .accessibilityIdentifier("tripPage.addExpense")
                        if !shell.isDemo, shell.trips.isAvailable, trip.sharedHouseholdId == nil {
                            PennyButton("Share trip", systemImage: "person.badge.plus", role: .secondary) {
                                sharing = true
                            }
                            .accessibilityIdentifier("tripPage.share")
                        }
                    }
                    .padding(.top, 16)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 4))
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
                    .cardRow()
                    .accessibilityIdentifier("entry.\(entry.id)")
                }
            } header: {
                HStack {
                    Text("Trip expenses")
                    Spacer()
                    Text(TripText.expenses(summary.expenses.count))
                }
                .cardSectionHeader()
            } footer: {
                Text(TripText.datesNote)
            }

            if !summary.spending.isEmpty {
                let total = summary.spending.reduce(Int64(0)) { $0 + $1.amount }
                CardSection("By category") {
                    ForEach(summary.spending, id: \.category.id) { item in
                        let color = PennyColor.category(item.category.paletteColor)
                        HStack(spacing: 12) {
                            CategoryIcon(symbol: CategoryStyle.symbol(forIonicon: item.category.icon), color: color)
                            // `iphone-trip-personal`: each category's part of your spending as a bar.
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.category.name)
                                ShareBar(fraction: total > 0 ? Double(item.amount) / Double(total) : 0, color: color)
                            }
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
        .contentMargins(.top, 0, for: .scrollContent)
        .background(alignment: .top) { Color.clear.frame(height: 1).heroGlow(blobs: GlowBlob.trip) }
        .refreshable {
            await shell.workspace.reload()
            if trip.sharedHouseholdId != nil { await shell.households.refresh() }
        }
        .navigationTitle(trip.name)
        .toolbar {
            // The hero leads with the name, so the bar has none (`iphone-trip-personal`).
            ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
            ToolbarItem(placement: .primaryAction) {
                Button("Edit trip") { editing = true }
                    .neutralToolbarGlyph()
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

/// An expense of yours on a trip, as the trip cards draw it: the category tile, the title,
/// "Feb 14 · Visa" (with a Before the trip or After the trip chip when it is dated outside a
/// personal trip), then your share, unsigned, with the receipt total when the expense is split.
/// `privateInline` is `ipad-trip`'s private row among the shared ones: "🔒 Only you · Sep 28".
struct TripEntryRow: View {
    let entry: LedgerEntry
    let ledger: Ledger
    /// Nil for private expenses on a shared trip, where the dates are the shared trip's.
    let range: TripRange?
    /// A private expense on a shared trip.
    var onSharedTrip = false
    var privateInline = false

    var body: some View {
        let category = ledger.category(id: entry.categoryId)
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: EntryText.tileSymbol(entry.kind, category: category),
                color: EntryText.tileColor(entry.kind, category: category, id: entry.categoryId))
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.callout.weight(.semibold)).foregroundStyle(PennyColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                if privateInline {
                    Label("Only you · \(day)", systemImage: "lock")
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .labelStyle(CompactLabelStyle())
                } else {
                    HStack(spacing: 6) {
                        Text(meta).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                            .fixedSize(horizontal: false, vertical: true)
                        if let outside { Text(outside).tripChip() }
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(
                    entry.share, meaning: .neutral, currency: ledger.currency.rawValue,
                    style: .callout.weight(.semibold))
                if entry.share != entry.total {
                    Text("of \(MoneyFormat.amount(entry.total, currency: ledger.currency.rawValue))")
                        .font(.caption.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var day: String { DayText.date(entry.date).formatted(.dateTime.month(.abbreviated).day()) }

    /// "Feb 14 · Visa", or the category when the expense has no account.
    private var meta: String {
        let account = entry.accountId.flatMap(ledger.account(id:))?.name
        return [day, account ?? ledger.category(id: entry.categoryId)?.name ?? "Unknown category"]
            .joined(separator: " · ")
    }

    /// "Before the trip" or "After the trip" for a personal trip's expense dated outside it.
    private var outside: String? {
        guard let range, !range.contains(entry.date) else { return nil }
        return entry.date < range.start ? "Before the trip" : "After the trip"
    }
}

/// An icon and title with a tight gap, for a footnote line.
private struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

/// The trip cards' chip: a small icon and word on the fill color ("🔒 Personal"), or the icon
/// and words alone for a line such as "1 outside the trip dates".
struct TripChipLabelStyle: LabelStyle {
    var chip = true

    func makeBody(configuration: Configuration) -> some View {
        let label = HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
        if chip {
            label
                .font(.caption.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        } else {
            label
        }
    }
}

extension View {
    /// A word on the fill color, as the trip cards' row chip ("Before the trip").
    func tripChip() -> some View {
        font(.caption2.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .fixedSize()
    }
}
