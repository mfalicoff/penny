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

/// Expenses for a shared trip: every shared expense of the trip whatever its month, oldest
/// first (each opens its detail), then your private expenses from before sharing.
/// `iphone-trip-detail` lists them as Shared with everyone, then Only you; `ipad-trip` as one
/// Expenses card headed "4 shared · 1 private", with the private rows marked inline.
struct SharedTripExpenseSections: View {
    let context: SharedTripContext
    let model: HouseholdModel
    /// `ipad-trip`'s one Expenses card.
    var combined = false
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let shared = (context.expenses?.expenses ?? []).sorted { ($0.date, $0.id) < ($1.date, $1.id) }
        let privateEntries =
            context.ledger == nil ? [] : context.privateEntries.sorted { ($0.date, $0.id) < ($1.date, $1.id) }
        if combined {
            Section {
                PanelTitle("Expenses", detail: Self.counts(shared: shared.count, private: privateEntries.count))
                    .accessibilityIdentifier("tripPage.sharedExpenses")
                emptyState(shared: shared, privateCount: privateEntries.count)
                ForEach(shared) { sharedRow($0) }
                ForEach(privateEntries, id: \.id) { privateRow($0, inline: true) }
            }
        } else {
            Section {
                emptyState(shared: shared, privateCount: 0)
                ForEach(shared) { sharedRow($0) }
            } header: {
                HStack {
                    Text("Shared with everyone")
                    Spacer()
                    Text(TripText.expenses(shared.count))
                }
                .cardSectionHeader()
                .accessibilityIdentifier("tripPage.sharedExpenses")
            }
            if !privateEntries.isEmpty {
                Section {
                    ForEach(privateEntries, id: \.id) { privateRow($0, inline: false) }
                } header: {
                    HStack {
                        // The card keeps "Only you" in its own case beside the upper-case note.
                        Label("Only you", systemImage: "lock").textCase(nil)
                        Spacer()
                        Text("from before sharing")
                    }
                    .cardSectionHeader()
                    .accessibilityIdentifier("tripPage.onlyYou")
                }
            }
            if sizeClass == .regular {
                SharedTripShareByCategory(context: context, model: model)
            }
        }
    }

    /// "4 shared · 1 private", or "4 shared" with none of your own.
    static func counts(shared: Int, private count: Int) -> String {
        count > 0 ? "\(shared) shared · \(count) private" : "\(shared) shared"
    }

    @ViewBuilder
    private func emptyState(shared: [WireSharedExpense], privateCount: Int) -> some View {
        if let failure = context.expenses?.load.failure, shared.isEmpty {
            Text(failure.message).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
        } else if shared.isEmpty, privateCount == 0, context.expenses?.load != .loading {
            Text(
                model.isReadOnly
                    ? "No shared expenses you can see on this trip."
                    : "No shared expenses yet. Add one with Trip expense; everyone on the trip sees it and their share."
            )
            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
        }
    }

    private func sharedRow(_ expense: WireSharedExpense) -> some View {
        NavigationLink(value: DetailRoute.householdExpense(householdID: model.id, expenseID: expense.id)) {
            SharedTripExpenseRow(expense: expense, people: model.people, currency: model.currency)
        }
        .cardRow()
        .accessibilityIdentifier("household.expense.\(expense.id)")
    }

    @ViewBuilder
    private func privateRow(_ entry: LedgerEntry, inline: Bool) -> some View {
        if let ledger = context.ledger {
            NavigationLink(value: DetailRoute.entry(id: entry.id)) {
                TripEntryRow(entry: entry, ledger: ledger, range: nil, onSharedTrip: true, privateInline: inline)
            }
            .cardRow()
            .accessibilityIdentifier("entry.\(entry.id)")
        }
    }
}

/// A shared trip expense (`iphone-trip-detail`, `ipad-trip`): the category tile, the title,
/// "Oct 2 · Sam paid · split 4 ways" (or "you paid"), then the total over your part of it
/// ("$206.00 yours").
struct SharedTripExpenseRow: View {
    let expense: WireSharedExpense
    let people: HouseholdPeople
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: expense.category.symbol, color: expense.category.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(expense.title).font(.callout.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(Self.detail(expense, people: people)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(expense.totalCents, meaning: .neutral, currency: currency, style: .callout.weight(.semibold))
                Text(yours).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }

    private var yours: String {
        let share = expense.share(of: people.meId)
        return share > 0 ? "\(MoneyFormat.amount(share, currency: currency)) yours" : "Not part of your share"
    }

    /// "Oct 2 · Sam paid · split 4 ways", "Oct 8 · you paid", or "Nov 3 · Mira paid" when only
    /// one person shares it.
    static func detail(_ expense: WireSharedExpense, people: HouseholdPeople) -> String {
        let ways = expense.splits.filter { $0.amountCents > 0 }.count
        let payer: String
        if expense.payerUserId == people.meId {
            payer = "you paid"
        } else {
            let name = people.name(expense.payerUserId)
            payer = ways > 1 ? "\(name) paid · split \(ways) ways" : "\(name) paid"
        }
        return "\(HouseholdText.day(expense.date)) · \(payer)"
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
                PanelTitle("Your share by category")
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
struct ShareBar: View {
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

/// A panel's title inside its card, with an optional note on the right (`ipad-trip`'s
/// "People · November balance", "Expenses · 4 shared · 1 private").
struct PanelTitle: View {
    let title: String
    var detail: String?

    init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.headline).foregroundStyle(PennyColor.label)
            Spacer(minLength: 8)
            if let detail { Text(detail).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel) }
        }
        .listRowSeparator(.hidden)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
