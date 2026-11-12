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

/// The trip's dates, people and numbers, above the month balance.
struct SharedTripSummary: View {
    @Environment(ShellModel.self) private var shell
    let context: SharedTripContext
    let model: HouseholdModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(context.range.phaseLabel(today: shell.today))
                    .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.pending)
                    .accessibilityIdentifier("tripPage.phase")
                Label("Shared", systemImage: "person.2")
                    .font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                if model.isArchived {
                    Text("Archived").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            Text(dateLine).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("tripPage.dates")
            HStack(alignment: .top, spacing: 24) {
                stat("Trip total", context.totals?.tripTotal)
                    .accessibilityIdentifier("tripPage.total")
                stat("Your spending", context.totals?.yourSpending)
                    .accessibilityIdentifier("tripPage.yourSpending")
            }
            if let note {
                Text(note).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("tripPage.privateNote")
            }
        }
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
                "Your spending includes \(MoneyFormat.amount(totals.privateShare, currency: model.currency)) only "
                    + "you can see.")
        }
        if totals.outside > 0 { parts.append(TripText.outside(totals.outside)) }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private func stat(_ label: String, _ cents: Int64?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            if let cents {
                MoneyText(cents, meaning: .neutral, currency: model.currency, style: .title3.weight(.bold))
            } else {
                Text("…").font(.title3.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
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
    }
}
