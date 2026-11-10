import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `filters`: Activity's period (a month, a year or all time), one day of it, the type and the
/// category. Changes apply as they are made; the period's totals never depend on them.
struct ActivityFiltersSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss

    private enum PeriodKind: Hashable { case month, year, allTime }

    var body: some View {
        @Bindable var shell = shell
        let filters = shell.activityFilters
        NavigationStack {
            Form {
                Section("Period") {
                    Picker("Period", selection: periodKind) {
                        Text("Month").tag(PeriodKind.month)
                        Text("Year").tag(PeriodKind.year)
                        Text("All time").tag(PeriodKind.allTime)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("filters.period")
                    switch filters.period {
                    case .month(let month):
                        stepper(MonthPicker.title(month, long: true), id: "filters.month") { delta in
                            if let next = month.shifted(by: delta) { shell.activityFilters.period = .month(next) }
                        }
                    case .year(let year):
                        stepper(String(year), id: "filters.year") { delta in
                            let next = year + delta
                            if (2000...2100).contains(next) { shell.activityFilters.period = .year(next) }
                        }
                    case .allTime:
                        EmptyView()
                    }
                }
                Section {
                    Toggle("One day", isOn: oneDay)
                        .tint(PennyColor.tint)
                        .accessibilityIdentifier("filters.oneDay")
                    if filters.day != nil {
                        DatePicker("Day", selection: day, in: dayRange(filters.period), displayedComponents: .date)
                            .accessibilityIdentifier("filters.day")
                    }
                } footer: {
                    Text("Totals always cover the whole period.")
                }
                Section("Type") {
                    Picker("Type", selection: $shell.activityFilters.kind) {
                        Text("All").tag(EntryKind?.none)
                        Text("Expenses").tag(EntryKind?.some(.expense))
                        Text("Income").tag(EntryKind?.some(.income))
                        Text("Investments").tag(EntryKind?.some(.investment))
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("filters.kind")
                }
                if let kind = filters.kind, let ledger = shell.workspace.load.ledger {
                    Section("Category") {
                        Picker("Category", selection: $shell.activityFilters.categoryId) {
                            Text("All categories").tag(String?.none)
                            ForEach(ledger.categoriesByUse(kind), id: \.id) { category in
                                Label(category.name, systemImage: EntryText.symbol(category))
                                    .tag(String?.some(category.id))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                        .accessibilityIdentifier("filters.category")
                    }
                }
            }
            .navigationTitle("Filters")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") {
                        shell.activityFilters.clearNarrowing()
                        shell.activityFilters.period = .month(shell.month)
                    }
                    .accessibilityIdentifier("filters.clear")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("filters.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("screen.activityFilters")
    }

    private var periodKind: Binding<PeriodKind> {
        Binding(
            get: {
                switch shell.activityFilters.period {
                case .month: .month
                case .year: .year
                case .allTime: .allTime
                }
            },
            set: { kind in
                switch kind {
                case .month: shell.activityFilters.period = .month(shell.month)
                case .year: shell.activityFilters.period = .year(shell.month.year)
                case .allTime: shell.activityFilters.period = .allTime
                }
            })
    }

    private var oneDay: Binding<Bool> {
        Binding(
            get: { shell.activityFilters.day != nil },
            set: { on in
                let period = shell.activityFilters.period
                shell.activityFilters.day = on ? Self.defaultDay(period, today: shell.today) : nil
            })
    }

    private var day: Binding<Date> {
        Binding(
            get: { DayText.date(shell.activityFilters.day ?? shell.today) },
            set: { shell.activityFilters.day = CalendarDate($0) })
    }

    /// Today when it is in the period, else the period's first day.
    static func defaultDay(_ period: ActivityFilters.Period, today: CalendarDate) -> CalendarDate {
        if period.contains(today) { return today }
        switch period {
        case .month(let month): return month.first
        case .year(let year): return CalendarDate(year: year, month: 1, day: 1) ?? today
        case .allTime: return today
        }
    }

    private func dayRange(_ period: ActivityFilters.Period) -> ClosedRange<Date> {
        let filters = ActivityFilters(period: period)
        let range = filters.dateRange
        return DayText.date(range.from ?? .earliest)...DayText.date(range.to ?? .latest)
    }

    private func stepper(_ title: String, id: String, step: @escaping (Int) -> Void) -> some View {
        HStack {
            Button("Previous", systemImage: "chevron.left") { step(-1) }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("\(id).previous")
            Spacer()
            Text(title).font(.body.weight(.semibold))
            Spacer()
            Button("Next", systemImage: "chevron.right") { step(1) }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("\(id).next")
        }
        .buttonStyle(.borderless)
    }
}
