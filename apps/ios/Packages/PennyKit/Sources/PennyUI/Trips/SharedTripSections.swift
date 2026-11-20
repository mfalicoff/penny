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

/// A shared trip's hero (`iphone-trip-detail`, `ipad-trip`): when it is, its name, dates and
/// people, then the trip total with your share, instead of a household's month balance (the
/// trip's balances still settle by month, under Balances). Your share counts your shares of the
/// shared expenses and your private expenses on it, as the Trips list's Your share so far.
struct SharedTripHero: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    let context: SharedTripContext
    let model: HouseholdModel

    var body: some View {
        let regular = sizeClass == .regular
        VStack(alignment: regular ? .leading : .center, spacing: 6) {
            HStack(spacing: 8) {
                Text(context.range.phaseLabel(today: shell.today))
                    .accessibilityIdentifier("tripPage.phase")
                if model.isArchived { Text("· Archived") }
            }
            .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
            Text(context.household.name).font(.title2.weight(.bold))
                .multilineTextAlignment(regular ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(dateLine).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(regular ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("tripPage.dates")
            if regular {
                HStack(alignment: .top, spacing: 32) {
                    stat("Trip total", context.totals?.tripTotal).accessibilityIdentifier("tripPage.total")
                    stat("Your share", context.totals?.yourSpending).accessibilityIdentifier("tripPage.yourSpending")
                }
                .padding(.top, 8)
            } else {
                amount(context.totals?.tripTotal)
                    .padding(.top, 8)
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

    private var dateLine: String {
        let count = model.people.current.count
        return [TripText.range(context.range), count == 1 ? "1 person" : "\(count) people", model.currency]
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
                MoneyText(cents, meaning: .neutral, currency: model.currency, style: .title.weight(.bold))
            } else {
                Text("…").font(.title.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
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
                    SharedExpenseRow(expense: expense, people: model.people, currency: model.currency)
                }
                .accessibilityIdentifier("household.expense.\(expense.id)")
            }
        } header: {
            HStack {
                Text("Shared with everyone")
                Spacer()
                Text(TripText.expenses(shared.count))
            }
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
                    .accessibilityIdentifier("entry.\(entry.id)")
                }
            } header: {
                HStack {
                    Label("Only you", systemImage: "lock")
                    Spacer()
                    Text("from before sharing")
                }
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
                ForEach(shareByCategory, id: \.name) { item in
                    HStack(spacing: 12) {
                        CategoryIcon(symbol: item.category.symbol, color: item.category.tint)
                        Text(item.name)
                        Spacer()
                        MoneyText(item.cents, meaning: .neutral, currency: model.currency)
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text("Your share by category")
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
