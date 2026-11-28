import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The Trips tab (`trips`, card `iphone-trips`, MAZ-76, MAZ-249): the trip happening now (or the
/// next one) over the trips' glow, then every trip by phase with its short dates, a Personal or
/// Shared chip and what it cost you. Join a trip (key) and New trip (+) are in the toolbar.
///
/// Personal trips come from the ledger on this device, so they show offline. Shared trips are
/// households with a travel range: they come from the server and the list keeps the last answer
/// when it can't refresh. A personal trip shared as a trip the account can still see is listed
/// once, as the shared trip.
struct TripsView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(InviteHandoff.self) private var invites: InviteHandoff?
    @State private var creating = false
    @State private var joining = false
    /// A trip created or joined in a sheet, opened once the sheet has gone.
    @State private var opened: String?

    var body: some View {
        WorkspaceContent { ledger in
            let directory = shell.households
            let known = directory.isAvailable && (directory.load == .loaded || !directory.households.isEmpty)
            let cards = TripList.cards(ledger: ledger, households: known ? directory.households : nil)
            let featured = TripList.featured(cards, today: shell.today)
            List {
                Section {
                    SyncBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    DemoBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    if let failure = directory.load.failure {
                        StatusBanner(
                            tone: failure.kind == .offline ? .offline : .error,
                            title: "Shared trips may be out of date", message: failure.message
                        )
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                        .accessibilityIdentifier("trips.notice")
                    }
                }
                .listSectionSeparator(.hidden)

                if let featured {
                    Section {
                        // `iphone-trips`: the featured trip is the whole card, with no chevron.
                        Button {
                            shell.route.push(.trip(id: featured.id))
                        } label: {
                            FeaturedTrip(card: featured, currency: ledger.currency.rawValue, today: shell.today)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(.isLink)
                        .accessibilityIdentifier("trips.featured")
                    }
                }
                let rest = cards.filter { $0.id != featured?.id }
                ForEach([TripPhase.now, .upcoming, .past], id: \.self) { phase in
                    let rows = rest.filter { $0.range.phase(today: shell.today) == phase }
                    if !rows.isEmpty {
                        CardSection(TripText.phaseTitle(phase)) {
                            ForEach(rows) { card in
                                NavigationLink(value: DetailRoute.trip(id: card.id)) {
                                    TripRow(card: card, currency: ledger.currency.rawValue, today: shell.today)
                                }
                                .cardRow()
                                .accessibilityIdentifier("trip.\(card.id)")
                            }
                        }
                    }
                }
            }
            .insetGroupedList()
            .background(alignment: .top) {
                Color.clear.frame(height: 1).heroGlow(blobs: GlowBlob.trip)
            }
            .overlay {
                if cards.isEmpty, directory.load != .loading {
                    PennyStateView(
                        .empty, title: "No trips yet",
                        message: "Trips group what you spend while away, so you can see what a trip cost."
                    )
                    .allowsHitTesting(false)
                }
            }
        }
        .refreshable {
            await shell.workspace.reload()
            await shell.households.refresh()
        }
        .task { await shell.households.refresh() }
        .background(PennyColor.background)
        .navigationTitle("Trips")
        .toolbar {
            // `iphone-trips`: Join (key) and New trip (+) as glass toolbar buttons.
            if shell.households.isAvailable {
                ToolbarItem(placement: .primaryAction) {
                    Button("Join a trip", systemImage: "key") { joining = true }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("trips.join")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button("New trip", systemImage: "plus") { creating = true }
                    .neutralToolbarGlyph()
                    .accessibilityIdentifier("trips.new")
            }
        }
        .sheet(isPresented: $creating, onDismiss: openCreated) {
            TripFormSheet(target: .new, expenseCount: 0) { saved in
                switch saved {
                case .personal(let trip): opened = trip.id
                case .shared(let household): opened = household.id
                case .deleted: break
                }
            }
            .environment(shell)
        }
        .sheet(isPresented: $joining, onDismiss: openCreated) {
            HouseholdStartSheet(start: .join(code: nil, server: nil), joinsTrip: true) { household in
                opened = household.id
            }
            .environment(shell).environment(invites)
        }
        .accessibilityIdentifier("screen.trips")
    }

    private func openCreated() {
        guard let id = opened else { return }
        opened = nil
        shell.route.push(.trip(id: id))
    }
}

/// The trip happening now, or the next one: when it is, its name, dates and people, and your
/// spending so far with a Personal or Shared chip.
private struct FeaturedTrip: View {
    @Environment(ShellModel.self) private var shell
    let card: TripCard
    let currency: String
    let today: CalendarDate

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.range.phaseLabel(today: today).uppercased())
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.pending)
                    Text(card.name).font(.title.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(Self.detail(card, today: today))
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 8)
                if case .shared(let household, _) = card.kind {
                    MonogramStack(faces: shell.households.memberFaces[household.id] ?? [], size: 30)
                }
            }
            HStack(alignment: .lastTextBaseline) {
                switch card.kind {
                case .personal(_, let total, _, _):
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You spent").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        MoneyText(total, meaning: .neutral, currency: currency, style: .title2.weight(.bold))
                    }
                case .shared(let household, _):
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Your share so far").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        if let share = TripShare.yours(household, range: card.range, shell: shell) {
                            MoneyText(
                                share, meaning: .neutral, currency: shell.currency, style: .title2.weight(.bold))
                        } else {
                            Text("…").font(.title2.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
                                .accessibilityLabel("Loading")
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("trips.featuredShare")
                }
                Spacer()
                TripKindBadge(card: card)
            }
            .padding(.top, 12)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .task(id: card.id) { await TripShare.load(card, shell: shell) }
    }

    /// "Nov 12–19 · 4 people" for a shared trip; a personal trip's dates alone. The chip says
    /// which it is, so the line doesn't.
    static func detail(_ card: TripCard, today: CalendarDate) -> String {
        let dates = TripText.shortRange(card.range, today: today)
        guard case .shared(let household, _) = card.kind else { return dates }
        return [dates, TripText.people(household.memberCount)].joined(separator: " · ")
    }
}

/// Your share of a shared trip, as its page counts it: your shares of its shared expenses plus
/// your private expenses on it, in your own currency (MAZ-151 phase 2: a trip in another currency
/// counts each shared expense at its home amounts).
@MainActor
enum TripShare {
    /// Nil until the trip's expenses have been read.
    static func yours(_ household: WireHousehold, range: TripRange, shell: ShellModel) -> Int64? {
        guard let loaded = shell.trips.expenses(for: household.id)?.loadedExpenses, let meId = shell.households.meId
        else { return nil }
        let ledger = shell.workspace.load.ledger
        let personal = ledger?.privateExpenses(linkedTo: household.id) ?? []
        return SharedTripTotals(
            expenses: loaded, meId: meId, personal: personal, range: range, householdCurrency: household.currency,
            home: shell.currency
        ).yourSpending
    }

    /// Reads a shared trip's expenses once, for your share; the trip page reads the same list.
    static func load(_ card: TripCard, shell: ShellModel) async {
        guard case .shared(let household, _) = card.kind,
            let expenses = shell.trips.expenses(for: household.id), !expenses.hasLoaded
        else { return }
        await expenses.refresh()
    }
}

/// A trip in the list (`iphone-trips`): its name, then its short dates with a Personal or Shared
/// chip, and what it cost you (your share, on a shared trip, once its expenses are read).
struct TripRow: View {
    @Environment(ShellModel.self) private var shell
    let card: TripCard
    let currency: String
    let today: CalendarDate

    var body: some View {
        HStack(spacing: 12) {
            // The card's neutral trip tile, shared or not: the chip says which.
            CategoryIcon.neutral(symbol: "airplane")
            VStack(alignment: .leading, spacing: 2) {
                Text(card.name).font(.callout.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text(Self.detail(card, today: today)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                    TripKindBadge(card: card, showsSymbol: false)
                }
            }
            Spacer(minLength: 8)
            switch card.kind {
            case .personal(_, let total, _, _):
                MoneyText(total, meaning: .neutral, currency: currency, style: .callout.weight(.semibold))
            case .shared(let household, _):
                if let share = TripShare.yours(household, range: card.range, shell: shell) {
                    MoneyText(share, meaning: .neutral, currency: shell.currency, style: .callout.weight(.semibold))
                }
            }
        }
        .accessibilityElement(children: .combine)
        .task(id: card.id) { await TripShare.load(card, shell: shell) }
    }

    /// "Oct 3–5", or "Oct 3–5 · was shared" for a personal trip whose shared trip is gone.
    static func detail(_ card: TripCard, today: CalendarDate) -> String {
        let dates = TripText.shortRange(card.range, today: today)
        if case .personal(_, _, _, true) = card.kind { return "\(dates) · was shared" }
        return dates
    }
}

/// "Personal" with a lock, or "Shared" with people: in words, never color alone.
struct TripKindBadge: View {
    let card: TripCard
    /// The featured trip's chip has a glyph; a row's chip is the word alone (`iphone-trips`).
    var showsSymbol = true

    var body: some View {
        Label(card.isShared ? "Shared" : "Personal", systemImage: card.isShared ? "person.2" : "lock")
            .labelStyle(BadgeLabelStyle(showsSymbol: showsSymbol))
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(PennyColor.fill, in: Capsule())
    }
}

private struct BadgeLabelStyle: LabelStyle {
    let showsSymbol: Bool

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            if showsSymbol { configuration.icon }
            configuration.title
        }
    }
}

/// Words for trips.
enum TripText {
    static func phaseTitle(_ phase: TripPhase) -> String {
        switch phase {
        case .now: "Now"
        case .upcoming: "Upcoming"
        case .past: "Past"
        }
    }

    /// "Nov 12, 2026", "Nov 12 – Nov 19, 2026" or, across a new year, both years.
    static func range(_ range: TripRange) -> String {
        let end = DayText.date(range.end).formatted(.dateTime.month(.abbreviated).day().year())
        if range.start == range.end { return end }
        let start =
            range.start.year == range.end.year
            ? DayText.date(range.start).formatted(.dateTime.month(.abbreviated).day())
            : DayText.date(range.start).formatted(.dateTime.month(.abbreviated).day().year())
        return "\(start) – \(end)"
    }

    /// The cards' short dates: "Nov 12–19", "Oct 30 – Nov 2" or "Nov 12", with the year only when
    /// it isn't this one ("Feb 14–21, 2027"), or always with `year` (`ipad-trip`).
    static func shortRange(_ range: TripRange, today: CalendarDate, year: Bool = false) -> String {
        let start = DayText.date(range.start).formatted(.dateTime.month(.abbreviated).day())
        let withYear = year || range.start.year != today.year || range.end.year != today.year
        if range.start.year != range.end.year {
            let format = Date.FormatStyle.dateTime.month(.abbreviated).day().year()
            return "\(DayText.date(range.start).formatted(format)) – \(DayText.date(range.end).formatted(format))"
        }
        let dates: String
        if range.start == range.end {
            dates = start
        } else if range.start.month == range.end.month {
            dates = "\(start)–\(DayText.date(range.end).formatted(.dateTime.day()))"
        } else {
            dates = "\(start) – \(DayText.date(range.end).formatted(.dateTime.month(.abbreviated).day()))"
        }
        return withYear ? "\(dates), \(range.end.year)" : dates
    }

    static func people(_ count: Int) -> String { count == 1 ? "1 person" : "\(count) people" }

    static func expenses(_ count: Int) -> String { count == 1 ? "1 expense" : "\(count) expenses" }

    /// "2 expenses are dated outside the trip and still belong to it."
    static func outside(_ count: Int) -> String {
        count == 1
            ? "1 expense is dated outside the trip and still belongs to it."
            : "\(count) expenses are dated outside the trip and still belong to it."
    }

    static let datesNote = "Expenses can be dated outside the trip: flights booked a month before still count."
}
