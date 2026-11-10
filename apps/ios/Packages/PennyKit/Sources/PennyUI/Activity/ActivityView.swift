import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Activity: the month's recorded entries grouped by day with each day's net, filter chips and
/// the system search field (at the bottom on iPhone in iOS 26, glass). Editing, swipe actions
/// and server search arrive with MAZ-73.
struct ActivityView: View {
    @Environment(ShellModel.self) private var shell
    @State private var query = ""
    @State private var kind: EntryKind?

    var body: some View {
        WorkspaceContent { ledger in
            let report = LedgerReport(ledger: ledger)
            let page = report.activity(.month(shell.month), query: query, kind: kind)
            let days = Self.days(page.entries)
            List {
                Section {
                    SyncBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    DemoBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    KindFilter(kind: $kind).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                .listSectionSeparator(.hidden)
                ForEach(days, id: \.day) { group in
                    Section {
                        ForEach(group.entries) { entry in
                            EntryRow(entry: entry, report: report, currency: ledger.currency.rawValue)
                                .listRowInsets(EdgeInsets())
                        }
                    } header: {
                        DayHeader(day: group.day, net: group.net, currency: ledger.currency.rawValue)
                    }
                }
            }
            .insetGroupedList()
            .overlay {
                if days.isEmpty {
                    if query.trimmingCharacters(in: .whitespaces).isEmpty {
                        PennyStateView(
                            .empty, title: "No entries in \(MonthPicker.title(shell.month, long: true))",
                            message: "Entries you add for this month show up here, grouped by day.")
                    } else {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
            .refreshable { await shell.workspace.reload() }
        }
        .background(PennyColor.background)
        .navigationTitle("Activity")
        .searchable(text: $query, prompt: "Search entries")
        .toolbar {
            ToolbarItem(placement: .navigation) { MonthPicker() }
        }
        .accessibilityIdentifier("screen.activity")
    }

    struct DayGroup: Equatable {
        let day: CalendarDate
        let entries: [ReportEntry]
        /// Income minus expenses and contributions of the day (your shares).
        let net: Int64
    }

    /// Groups entries (already newest first) by day, keeping their order.
    static func days(_ entries: [ReportEntry]) -> [DayGroup] {
        var groups: [DayGroup] = []
        for entry in entries {
            if let last = groups.last, last.day == entry.date {
                groups[groups.count - 1] = DayGroup(
                    day: last.day, entries: last.entries + [entry], net: last.net + signed(entry))
            } else {
                groups.append(DayGroup(day: entry.date, entries: [entry], net: signed(entry)))
            }
        }
        return groups
    }

    private static func signed(_ entry: ReportEntry) -> Int64 {
        entry.kind == .income ? entry.share : -entry.share
    }
}

private struct DayHeader: View {
    @Environment(ShellModel.self) private var shell
    let day: CalendarDate
    let net: Int64
    let currency: String

    var body: some View {
        HStack {
            Text(DayText.long(day, today: shell.today))
            Spacer()
            Text(MoneyFormat.signed(net, meaning: .neutral, currency: currency)).monospacedDigit()
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(PennyColor.secondaryLabel)
        .accessibilityElement(children: .combine)
    }
}

/// All / Expenses / Income / Invest chips.
struct KindFilter: View {
    @Binding var kind: EntryKind?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", nil)
                chip("Expenses", .expense)
                chip("Income", .income)
                chip("Invest", .investment)
            }
            .padding(.vertical, 4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter")
    }

    private func chip(_ title: String, _ value: EntryKind?) -> some View {
        let selected = kind == value
        return Button(title) { kind = value }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: Metrics.minTouchTarget)
            .foregroundStyle(selected ? Color.white : PennyColor.label)
            .background(selected ? PennyColor.tint : PennyColor.fill, in: Capsule())
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
