import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A household's change history (`iphone-history`, the redesign's `history`): every change, by
/// everyone, newest first and grouped by day, with All, Expenses, Payments and Members. Former
/// members see the history they took part in; snapshots never include anyone's private account.
struct HouseholdHistoryView: View {
    @Environment(ShellModel.self) private var shell
    let householdID: String

    var body: some View {
        Group {
            if let model = shell.households.model(for: householdID) {
                HistoryList(model: model)
            } else {
                PennyStateView(.unavailable, title: "History", message: "Households need your account.")
            }
        }
        .background(PennyColor.background)
        .navigationTitle("History")
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.householdHistory")
    }
}

private struct HistoryList: View {
    @Bindable var model: HouseholdModel
    @State private var filter: AuditFilter = .all
    @State private var events: [WireAuditEvent]?
    @State private var failure: HouseholdFailure?

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(AuditFilter.allCases, id: \.self) { option in
                            Button(option.title) { filter = option }
                                .buttonStyle(.bordered)
                                .tint(filter == option ? PennyColor.tint : PennyColor.secondaryLabel)
                                .accessibilityAddTraits(filter == option ? .isSelected : [])
                                .accessibilityIdentifier("history.filter.\(option.rawValue)")
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                Text("\(model.household?.name ?? "Household") · every change, by everyone")
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .listRowBackground(Color.clear)
                if let failure {
                    HouseholdFailureBanner(failure: failure) { Task { await load() } }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            }
            .listSectionSeparator(.hidden)
            ForEach(groups, id: \.day) { group in
                Section(group.title) {
                    ForEach(group.events) { event in
                        AuditRow(event: event, people: model.people, currency: model.currency)
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

    private struct DayGroup {
        var day: CalendarDate
        var title: String
        var events: [WireAuditEvent]
    }

    private var groups: [DayGroup] {
        let visible = (events ?? []).filter { filter.includes($0.action) }
        var result: [DayGroup] = []
        let today = CalendarDate(Date())
        for event in visible {
            let day = CalendarDate(Date(milliseconds: event.createdAt))
            if result.last?.day == day {
                result[result.count - 1].events.append(event)
            } else {
                result.append(DayGroup(day: day, title: DayText.long(day, today: today), events: [event]))
            }
        }
        return result
    }
}

/// One change, in words, with what an edit changed.
struct AuditRow: View {
    let event: WireAuditEvent
    let people: HouseholdPeople
    let currency: String

    var body: some View {
        let description = AuditDescription(event, people: people, money: HouseholdText.money(currency))
        HStack(alignment: .top, spacing: 12) {
            Monogram(initials: people.initials(event.actorId))
            VStack(alignment: .leading, spacing: 2) {
                Text(description.summary).font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(description.changes, id: \.self) { change in
                    Text(change).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Text(HouseholdText.instant(event.createdAt).formatted(date: .omitted, time: .shortened))
                .font(.footnote.monospacedDigit()).foregroundStyle(PennyColor.secondaryLabel)
        }
        .accessibilityElement(children: .combine)
    }
}
