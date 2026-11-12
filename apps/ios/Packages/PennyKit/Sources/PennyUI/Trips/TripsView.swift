import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The Trips tab (`trips`, card `iphone-trips`, MAZ-76): the trip happening now (or the next one)
/// with its numbers and Trip expense, then every trip by phase: personal trips with what you
/// spent, shared trips with their people. New trip and Join a trip.
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
                        NavigationLink(value: DetailRoute.trip(id: featured.id)) {
                            FeaturedTrip(card: featured, currency: ledger.currency.rawValue, today: shell.today)
                        }
                        .accessibilityIdentifier("trips.featured")
                        if canAdd(featured) {
                            Button("Trip expense", systemImage: "plus") { addExpense(featured) }
                                .font(.body.weight(.semibold))
                                .frame(minHeight: Metrics.minTouchTarget)
                                .accessibilityIdentifier("trips.featuredAdd")
                        }
                    }
                }
                let rest = cards.filter { $0.id != featured?.id }
                ForEach([TripPhase.now, .upcoming, .past], id: \.self) { phase in
                    let rows = rest.filter { $0.range.phase(today: shell.today) == phase }
                    if !rows.isEmpty {
                        Section(TripText.phaseTitle(phase)) {
                            ForEach(rows) { card in
                                NavigationLink(value: DetailRoute.trip(id: card.id)) {
                                    TripRow(card: card, currency: ledger.currency.rawValue)
                                }
                                .accessibilityIdentifier("trip.\(card.id)")
                            }
                        }
                    }
                }
                Section {
                    Button {
                        creating = true
                    } label: {
                        ActionRow(
                            title: "New trip", detail: "Group what you spend while away, on your own or with others",
                            symbol: "plus")
                    }
                    .accessibilityIdentifier("trips.new")
                    if directory.isAvailable {
                        Button {
                            joining = true
                        } label: {
                            ActionRow(
                                title: "Join a trip", detail: "Someone shared an invite code or QR code with you",
                                symbol: "qrcode.viewfinder")
                        }
                        .accessibilityIdentifier("trips.join")
                    }
                } footer: {
                    Text(
                        "Personal trips stay on your devices and work offline. Shared trips live on your server, "
                            + "so creating, joining and changing them needs a connection.")
                }
            }
            .insetGroupedList()
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

    private func canAdd(_ card: TripCard) -> Bool {
        switch card.kind {
        case .personal: true
        case .shared: shell.trips.isAvailable
        }
    }

    /// Trip expense: a personal expense on a personal trip; on a shared trip, its page opens with
    /// the shared expense form.
    private func addExpense(_ card: TripCard) {
        switch card.kind {
        case .personal(let trip, _, _, _): shell.openTripExpense(trip.id)
        case .shared(let household, _):
            shell.trips.pendingAdd = household.id
            shell.route.push(.trip(id: household.id))
        }
    }
}

/// The trip happening now, or the next one: when it is, its name, dates and people, and your
/// spending so far.
private struct FeaturedTrip: View {
    @Environment(ShellModel.self) private var shell
    let card: TripCard
    let currency: String
    let today: CalendarDate

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(card.range.phaseLabel(today: today).uppercased())
                .font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.pending)
            Text(card.name).font(.title2.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(TripRow.detail(card))
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            HStack(alignment: .lastTextBaseline) {
                switch card.kind {
                case .personal(_, let total, _, _):
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You spent").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        MoneyText(total, meaning: .neutral, currency: currency, style: .title3.weight(.bold))
                    }
                case .shared(let household, _):
                    MonogramStack(initials: shell.households.memberInitials[household.id] ?? [])
                }
                Spacer()
                TripKindBadge(card: card)
            }
            .padding(.top, 6)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

struct TripRow: View {
    let card: TripCard
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: card.isShared ? "person.2" : "airplane",
                color: card.isShared ? PennyColor.tint : PennyColor.category(.home))
            VStack(alignment: .leading, spacing: 2) {
                Text(card.name).font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(Self.detail(card)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if case .personal(_, let total, _, _) = card.kind {
                MoneyText(total, meaning: .neutral, currency: currency)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    /// "Nov 12 – Nov 19, 2026 · Personal · 3 expenses" or "… · Shared · 4 people".
    static func detail(_ card: TripCard) -> String {
        var parts = [TripText.range(card.range)]
        switch card.kind {
        case .personal(_, _, let count, let wasShared):
            parts.append(wasShared ? "Personal · was shared" : "Personal")
            parts.append(count == 1 ? "1 expense" : "\(count) expenses")
        case .shared(let household, _):
            parts.append("Shared")
            parts.append(household.memberCount == 1 ? "1 person" : "\(household.memberCount) people")
        }
        return parts.joined(separator: " · ")
    }
}

/// "Personal" with a lock, or "Shared" with people: in words, never color alone.
struct TripKindBadge: View {
    let card: TripCard

    var body: some View {
        Label(card.isShared ? "Shared" : "Personal", systemImage: card.isShared ? "person.2" : "lock")
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(PennyColor.fill, in: Capsule())
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

    static func expenses(_ count: Int) -> String { count == 1 ? "1 expense" : "\(count) expenses" }

    /// "2 expenses are dated outside the trip and still belong to it."
    static func outside(_ count: Int) -> String {
        count == 1
            ? "1 expense is dated outside the trip and still belongs to it."
            : "\(count) expenses are dated outside the trip and still belong to it."
    }

    static let datesNote = "Expenses can be dated outside the trip: flights booked a month before still count."
}
