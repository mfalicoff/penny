import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A household's change history (`iphone-history`, the redesign's `history`): the large History
/// title, "<name> · every change, by everyone", then All, Expenses, Payments and Members, and
/// every change, by everyone, newest first and grouped by day. Each actor's avatar has a badge
/// for the kind of change. Former members see the history they took part in; snapshots never
/// include anyone's private account.
struct HouseholdHistoryView: View {
    @Environment(ShellModel.self) private var shell
    let householdID: String

    var body: some View {
        Group {
            if let model = shell.households.model(for: householdID) {
                HistoryList(model: model, today: shell.today)
            } else {
                PennyStateView(.unavailable, title: "History", message: "Households need your account.")
            }
        }
        .background(PennyColor.background)
        .navigationTitle("History")
        #if os(iOS)
            // The card's large title, though the household it opens from is inline.
            .navigationBarTitleDisplayMode(.large)
        #endif
        .accessibilityIdentifier("screen.householdHistory")
    }
}

private struct HistoryList: View {
    @Bindable var model: HouseholdModel
    /// The app's today (`ShellModel.today`), so the first group reads Today on the right day.
    let today: CalendarDate
    @State private var filter: AuditFilter = .all
    @State private var events: [WireAuditEvent]?
    @State private var failure: HouseholdFailure?

    var body: some View {
        List {
            // The card's subtitle right under the large title, then the chips.
            Section {
                Text("\(model.household?.name ?? "Household") · every change, by everyone")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("history.subtitle")
            }
            .compactSectionSpacing()
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(AuditFilter.allCases, id: \.self) { option in
                            Button(option.title) { filter = option }
                                .buttonStyle(PillButtonStyle(selected: filter == option))
                                .accessibilityAddTraits(filter == option ? .isSelected : [])
                                .accessibilityIdentifier("history.filter.\(option.rawValue)")
                        }
                    }
                }
                .scrollClipDisabled()
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                if let failure {
                    HouseholdFailureBanner(failure: failure) { Task { await load() } }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            }
            .listSectionSeparator(.hidden)
            ForEach(groups, id: \.day) { group in
                CardSection(group.title) {
                    ForEach(group.events) { event in
                        AuditRow(
                            event: event, people: model.people, currency: model.currency,
                            expenseTitle: expenseTitle, isTrip: model.household?.trip != nil
                        )
                        .cardRow()
                        .accessibilityIdentifier("history.event.\(event.id)")
                    }
                }
            }
        }
        .insetGroupedList()
        .overlay {
            if events == nil, failure == nil {
                PennyStateView(.loading, title: "Loading history…")
            } else if events?.isEmpty == false, groups.isEmpty {
                PennyStateView(.empty, title: "Nothing here", message: "No \(filter.title.lowercased()) changes yet.")
                    .accessibilityIdentifier("history.empty")
            } else if events?.isEmpty == true {
                PennyStateView(.empty, title: "No changes yet")
                    .accessibilityIdentifier("history.empty")
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        if model.detail == nil { await model.refresh() }
        switch await model.history() {
        case .success(let loaded):
            events = loaded
            failure = nil
        case .failure(let refused):
            failure = refused
        }
    }

    /// An expense's title for a payment row ("$61.40 for Costco run"): from the history itself
    /// (its latest snapshot), or the month on screen.
    private var expenseTitle: (String) -> String? {
        var titles: [String: String] = [:]
        for event in (events ?? []).reversed() {
            guard let id = event.expenseId else { continue }
            if let title = event.after?["title"]?.string ?? event.before?["title"]?.string { titles[id] = title }
        }
        for expense in model.expenses where titles[expense.id] == nil { titles[expense.id] = expense.title }
        return { titles[$0] }
    }

    private struct DayGroup {
        var day: CalendarDate
        var title: String
        var events: [WireAuditEvent]
    }

    private var groups: [DayGroup] {
        let visible = (events ?? []).filter { filter.includes($0.action) }
        var result: [DayGroup] = []
        for event in visible {
            let day = CalendarDate(Date(milliseconds: event.createdAt))
            if result.last?.day == day {
                result[result.count - 1].events.append(event)
            } else {
                result.append(DayGroup(day: day, title: DayText.medium(day, today: today), events: [event]))
            }
        }
        return result
    }
}

/// One change, in words, with what an edit changed: the actor's avatar with a badge for the
/// kind of change, the sentence, the detail lines and the time.
struct AuditRow: View {
    let event: WireAuditEvent
    let people: HouseholdPeople
    let currency: String
    var expenseTitle: (String) -> String? = { _ in nil }
    var isTrip = false

    var body: some View {
        let description = AuditDescription(
            event, people: people, money: HouseholdText.money(currency), expenseTitle: expenseTitle,
            day: { HouseholdText.instant($0).formatted(.dateTime.month(.abbreviated).day()) },
            group: isTrip ? "trip" : "household")
        HStack(alignment: .top, spacing: 12) {
            Monogram(face: people.face(event.actorId))
                .overlay(alignment: .bottomTrailing) { AuditBadge(kind: AuditBadge.Kind(event)).offset(x: 4, y: 4) }
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.emphasized(description)).font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Self.details(description), id: \.self) { line in
                    Text(line).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Text(HouseholdText.instant(event.createdAt).formatted(date: .omitted, time: .shortened))
                .font(.footnote.monospacedDigit()).foregroundStyle(PennyColor.tertiaryLabel)
        }
        // Struck-through text reads like the new value to VoiceOver, so the row speaks the words.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            ([description.summary] + description.changes
                + [HouseholdText.instant(event.createdAt).formatted(date: .omitted, time: .shortened)])
                .joined(separator: ", "))
    }
}

extension AuditRow {
    /// The sentence with its names in bold, as on the card ("**Mira** added **Hydro**").
    static func emphasized(_ description: AuditDescription) -> AttributedString {
        var text = AttributedString(description.summary)
        var searchFrom = text.startIndex
        for name in description.emphasis where !name.isEmpty {
            guard let range = text[searchFrom...].range(of: name) else { continue }
            text[range].inlinePresentationIntent = .stronglyEmphasized
            searchFrom = range.upperBound
        }
        return text
    }

    /// The detail lines: each edit as "Category ~~Shopping~~ → Groceries", or the description's words.
    static func details(_ description: AuditDescription) -> [AttributedString] {
        guard !description.edits.isEmpty else { return description.changes.map { AttributedString($0) } }
        return description.edits.map { edit in
            var old = AttributedString(edit.before)
            old.strikethroughStyle = .single
            return AttributedString("\(edit.label) ") + old + AttributedString(" → \(edit.after)")
        }
    }
}

/// The small badge on an actor's avatar in History (`iphone-history`): + for an added expense,
/// a green check for a payment, a pencil for an edit, repeat for a repeating expense, a person
/// for members and invites, a bin for a deletion. Decoration only: the sentence says the same.
struct AuditBadge: View {
    enum Kind: Equatable {
        case added, payment, edited, repeating, member, memberLeft, removed

        init(_ event: WireAuditEvent) {
            let action = event.action
            if action == "expense.created", event.after?["recurringId"]?.string != nil {
                self = .repeating
            } else if action.hasPrefix("reimbursement.") {
                self = .payment
            } else if action == "member.left" || action == "member.removed" {
                self = .memberLeft
            } else if action.hasPrefix("member.") || action.hasPrefix("invite.") {
                self = .member
            } else if action.hasPrefix("recurring.") {
                self = .repeating
            } else if action.hasSuffix(".created") {
                self = .added
            } else if action.hasSuffix(".deleted") || action.hasSuffix(".archived") {
                self = .removed
            } else {
                self = .edited
            }
        }

        var symbol: String {
            switch self {
            case .added: "plus"
            case .payment: "checkmark"
            case .edited: "square.and.pencil"
            case .repeating: "repeat"
            case .member: "person.badge.plus"
            case .memberLeft: "person.badge.minus"
            case .removed: "trash"
            }
        }
    }

    let kind: Kind
    @ScaledMetric(relativeTo: .caption2) private var size: Double = 18

    var body: some View {
        Image(systemName: kind.symbol)
            .font(.system(size: size * 0.5, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(kind == .payment ? PennyColor.income : PennyColor.secondaryLabel, in: Circle())
            .overlay(Circle().stroke(PennyColor.surface, lineWidth: 2))
            .accessibilityHidden(true)
    }
}
