import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// What a shared trip adds to the household page (`shared-trip`, `trip-people`, `trip-balances`;
/// cards `iphone-trip-detail`, `ipad-trip`; MAZ-76): its dates and phase, the trip total and your
/// spending, then Expenses for the whole trip with your private expenses from before sharing
/// under Only you. Balances (by month) and People are the household's.
struct SharedTripContext {
    let household: WireHousehold
    let range: TripRange
    let expenses: SharedTripExpenses?
    /// Your expenses on personal trips linked to this one, when they are in the trip's currency.
    let privateEntries: [LedgerEntry]
    let ledger: Ledger?
    let totals: SharedTripTotals?

    @MainActor
    init?(model: HouseholdModel, shell: ShellModel) {
        guard let household = model.household, let range = household.tripRange else { return nil }
        self.household = household
        self.range = range
        expenses = shell.trips.expenses(for: model.id)
        let ledger = shell.workspace.load.ledger
        self.ledger = ledger
        // Private expenses are in the ledger currency; a trip in another one can't add them up.
        let personal =
            ledger.map { $0.currency.rawValue == household.currency ? $0.privateExpenses(linkedTo: model.id) : [] }
            ?? []
        privateEntries = personal
        // Totals only from a list that was read: during a first read, or after it failed, the
        // empty list isn't the trip's, so the stats show a placeholder rather than $0.00.
        let meId = model.people.meId
        totals = expenses?.loadedExpenses.map {
            SharedTripTotals(expenses: $0, meId: meId, personal: personal, range: range)
        }
    }
}

/// A shared trip's hero (`iphone-trip-detail`, `ipad-trip`; MAZ-249): its name, short dates and
/// people, then the trip total with your share (on iPad, when it is above the large name, and the
/// two totals side by side), instead of a household's month balance (the
/// trip's balances still settle by month, under Balances). Your share counts your shares of the
/// shared expenses and your private expenses on it, as the Trips list's Your share so far.
struct SharedTripHero: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    let context: SharedTripContext
    let model: HouseholdModel
    /// `ipad-trip`: the name at 40 points.
    @ScaledMetric(relativeTo: .largeTitle) private var wideNameSize = 40.0

    var body: some View {
        let regular = sizeClass == .regular
        VStack(alignment: regular ? .leading : .center, spacing: regular ? 2 : 4) {
            // `ipad-trip` names when the trip is ("IN 3 DAYS"); `iphone-trip-detail` leads with the name.
            if regular || model.isArchived {
                HStack(spacing: 8) {
                    if regular {
                        Text(context.range.phaseLabel(today: shell.today).uppercased())
                            .accessibilityIdentifier("tripPage.phase")
                    }
                    if model.isArchived { Text(regular ? "· ARCHIVED" : "ARCHIVED") }
                }
                .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
            }
            Text(context.household.name)
                .font(regular ? .system(size: wideNameSize, weight: .bold) : .title.weight(.bold))
                .multilineTextAlignment(regular ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(dateLine(regular: regular)).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(regular ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("tripPage.dates")
            if regular {
                HStack(alignment: .top, spacing: 34) {
                    stat("Trip total", context.totals?.tripTotal).accessibilityIdentifier("tripPage.total")
                    stat("Your share", context.totals?.yourSpending).accessibilityIdentifier("tripPage.yourSpending")
                }
                .padding(.top, 14)
            } else {
                amount(context.totals?.tripTotal)
                    .padding(.top, 10)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        "Trip total, \(context.totals.map { MoneyFormat.amount($0.tripTotal, currency: model.currency) } ?? "loading")"
                    )
                    .accessibilityIdentifier("tripPage.total")
                HStack(spacing: 4) {
                    Text("trip total · your share").foregroundStyle(PennyColor.secondaryLabel)
                    Text(context.totals.map { MoneyFormat.amount($0.yourSpending, currency: model.currency) } ?? "…")
                        .fontWeight(.semibold).monospacedDigit()
                }
                .font(.subheadline)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("tripPage.yourSpending")
            }
            if let note {
                Text(note).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(regular ? .leading : .center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
                    .accessibilityIdentifier("tripPage.privateNote")
            }
        }
        .frame(maxWidth: .infinity, alignment: regular ? .leading : .center)
    }

    /// "Nov 12–19 · 4 people" on iPhone; "Nov 12–19, 2026 · shared with 3 people" on iPad.
    private func dateLine(regular: Bool) -> String {
        let count = model.people.current.count
        let dates = TripText.shortRange(context.range, today: shell.today, year: regular)
        guard regular else { return [dates, TripText.people(count)].joined(separator: " · ") }
        let others = count - 1
        return [dates, others > 0 ? "shared with \(TripText.people(others))" : TripText.people(count)]
            .joined(separator: " · ")
    }

    private var note: String? {
        guard let totals = context.totals else { return nil }
        var parts: [String] = []
        if totals.privateShare > 0 {
            parts.append(
                "Your share includes \(MoneyFormat.amount(totals.privateShare, currency: model.currency)) only you "
                    + "can see.")
        }
        if totals.outside > 0 { parts.append(TripText.outside(totals.outside)) }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    @ViewBuilder
    private func amount(_ cents: Int64?) -> some View {
        Text(cents.map { MoneyFormat.amount($0, currency: model.currency) } ?? "…")
            .modifier(HeroAmountFont())
            .foregroundStyle(cents == nil ? PennyColor.secondaryLabel : PennyColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
    }

    private func stat(_ label: String, _ cents: Int64?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            if let cents {
                MoneyText(cents, meaning: .neutral, currency: model.currency, style: .largeTitle.weight(.bold))
            } else {
                Text("…").font(.largeTitle.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Expenses for a shared trip: every shared expense of the trip whatever its month (each opens
/// its detail), then Only you.
struct SharedTripExpenseSections: View {
    let context: SharedTripContext
    let model: HouseholdModel
    /// Off on a wide iPad page, where Your share by category is beside the expenses.
    var showsShareByCategory = true
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let shared = context.expenses?.expenses ?? []
        Section {
            if let failure = context.expenses?.load.failure, shared.isEmpty {
                Text(failure.message).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            } else if shared.isEmpty, context.expenses?.load != .loading {
                Text(
                    model.isReadOnly
                        ? "No shared expenses you can see on this trip."
                        : "No shared expenses yet. Add one with Trip expense; everyone on the trip sees it and their "
                            + "share."
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(shared) { expense in
                NavigationLink(
                    value: DetailRoute.householdExpense(householdID: model.id, expenseID: expense.id)
                ) {
                    SharedExpenseRow(expense: expense, people: model.people, currency: model.currency, showsDate: true)
                }
                .cardRow()
                .accessibilityIdentifier("household.expense.\(expense.id)")
            }
        } header: {
            HStack {
                Text("Shared with everyone")
                Spacer()
                Text(TripText.expenses(shared.count))
            }
            .cardSectionHeader()
            .accessibilityIdentifier("tripPage.sharedExpenses")
        } footer: {
            Text(
                "Each expense is split among the people on the trip when it's added. Someone who joins later isn't "
                    + "in earlier expenses, and people who leave keep their past shares.")
        }
        if let ledger = context.ledger, !context.privateEntries.isEmpty {
            Section {
                ForEach(context.privateEntries, id: \.id) { entry in
                    NavigationLink(value: DetailRoute.entry(id: entry.id)) {
                        TripEntryRow(entry: entry, ledger: ledger, range: context.range)
                    }
                    .cardRow()
                    .accessibilityIdentifier("entry.\(entry.id)")
                }
            } header: {
                HStack {
                    // The card keeps "Only you" in its own case beside the upper-case note.
                    Label("Only you", systemImage: "lock").textCase(nil)
                    Spacer()
                    Text("from before sharing")
                }
                .cardSectionHeader()
                .accessibilityIdentifier("tripPage.onlyYou")
            } footer: {
                Text("Only you see these. They count in your spending, not in the trip's total or anyone's balance.")
            }
        }
        if sizeClass == .regular, showsShareByCategory {
            SharedTripShareByCategory(context: context, model: model)
        }
    }
}

/// `ipad-trip`'s Your share by category: your shares and private expenses on the trip, below
/// the expenses on a narrow iPad page or beside them on a wide one (MAZ-182).
struct SharedTripShareByCategory: View {
    let context: SharedTripContext
    let model: HouseholdModel

    var body: some View {
        if !shareByCategory.isEmpty {
            Section {
                let items = shareByCategory
                let total = items.reduce(Int64(0)) { $0 + $1.cents }
                ForEach(items, id: \.name) { item in
                    HStack(spacing: 12) {
                        CategoryIcon(symbol: item.category.symbol, color: item.category.tint)
                        Text(item.name).frame(minWidth: 80, alignment: .leading)
                        // `ipad-trip`: each category's part of your share as a bar in its color.
                        ShareBar(
                            fraction: total > 0 ? Double(item.cents) / Double(total) : 0, color: item.category.tint)
                        MoneyText(item.cents, meaning: .neutral, currency: model.currency)
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text("Your share by category").cardSectionHeader()
            } footer: {
                Text("Balances settle per month, so bookings and spending in different months are repaid separately.")
            }
        }
    }

    /// Your share of each category, largest first: shared expenses by their category, private
    /// expenses by the ledger's.
    private var shareByCategory: [(name: String, category: WireSharedCategory, cents: Int64)] {
        var totals: [String: (category: WireSharedCategory, cents: Int64)] = [:]
        let meId = model.people.meId
        for expense in context.expenses?.loadedExpenses ?? [] {
            let share = expense.share(of: meId)
            guard share > 0 else { continue }
            totals[expense.category.name, default: (expense.category, 0)].cents += share
        }
        if let ledger = context.ledger {
            for entry in context.privateEntries where entry.share > 0 {
                guard let category = ledger.category(id: entry.categoryId) else { continue }
                totals[category.name, default: (WireSharedCategory(category), 0)].cents += entry.share
            }
        }
        return totals.map { (name: $0.key, category: $0.value.category, cents: $0.value.cents) }
            .sorted { $0.cents != $1.cents ? $0.cents > $1.cents : $0.name < $1.name }
    }
}

/// A category's part of a total, as the cards draw it: a thin bar on the fill color.
private struct ShareBar: View {
    let fraction: Double
    let color: Color

    var body: some View {
        Capsule().fill(PennyColor.fill)
            .frame(height: 6)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule().fill(color).frame(width: proxy.size.width * min(max(fraction, 0), 1))
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}
