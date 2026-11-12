import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The month calendar (`calendar` card): a Monday-first grid with dots in the meaning colors
/// (gray spent, green income, indigo invested) and an amber ring for scheduled occurrences and
/// income dated after today (MAZ-136), then the chosen day's entries. Choosing a day filters
/// the list only; the month's totals above the grid never change with it. At accessibility text
/// sizes the grid becomes a list of the days that have entries, so nothing is squeezed into
/// seven columns.
struct CalendarView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var selection: CalendarDate?

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let summary = report.month(shell.month, today: shell.today)
            let calendar = CalendarMonth(summary)
            let currency = ledger.currency.rawValue
            let selected = Self.selectedDay(selection, month: shell.month, today: shell.today)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    MonthTotalsLine(summary: summary, currency: currency)
                    VStack(spacing: 12) {
                        if typeSize.isAccessibilitySize {
                            CalendarDayList(
                                calendar: calendar, selection: selected, currency: currency, today: shell.today
                            ) { selection = $0 }
                        } else {
                            CalendarGrid(
                                calendar: calendar, selection: selected, currency: currency, today: shell.today
                            ) { selection = $0 }
                        }
                        CalendarLegend()
                    }
                    .pennyCard(padding: 14)
                    if let selected {
                        DayDetail(
                            day: calendar.day(selected), entries: report.monthEntries(summary, day: selected),
                            report: report, currency: currency, today: shell.today)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Calendar")
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.calendar")
    }

    /// The chosen day if it is in the month; otherwise today in the current month, or nothing.
    static func selectedDay(_ selection: CalendarDate?, month: MonthKey, today: CalendarDate) -> CalendarDate? {
        if let selection, month.contains(selection) { return selection }
        return month.contains(today) ? today : nil
    }

    private var header: some View {
        @Bindable var shell = shell
        let first = MonthKey(CalendarDate.earliest)
        let last = MonthKey(shell.today)
        return HStack(spacing: 4) {
            Button {
                if let previous = shell.month.shifted(by: -1) { shell.month = previous }
            } label: {
                Image(systemName: "chevron.backward").frame(
                    width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
            }
            .disabled(shell.month <= first)
            .accessibilityLabel("Previous month")
            .accessibilityIdentifier("calendar.previous")
            Text(MonthPicker.title(shell.month, long: true))
                .font(.headline)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Button {
                if let next = shell.month.shifted(by: 1), next <= last { shell.month = next }
            } label: {
                Image(systemName: "chevron.forward").frame(
                    width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
            }
            .disabled(shell.month >= last)
            .accessibilityLabel("Next month")
            .accessibilityIdentifier("calendar.next")
            Button("Today") {
                shell.month = last
                selection = shell.today
            }
            .font(.subheadline.weight(.semibold))
            .frame(minHeight: Metrics.minTouchTarget)
            .padding(.horizontal, 12)
            .pennyGlass()
            .accessibilityIdentifier("calendar.today")
        }
        .tint(PennyColor.tintText)
    }
}

/// The month's recorded totals, unchanged by the day chosen below.
struct MonthTotalsLine: View {
    let summary: MonthSummary
    let currency: String

    var body: some View {
        let text = [
            "Spent \(MoneyFormat.amount(summary.recorded.expense, currency: currency))",
            "Came in \(MoneyFormat.amount(summary.recorded.income, currency: currency))",
            "Invested \(MoneyFormat.amount(summary.recorded.investment, currency: currency))",
        ].joined(separator: " · ")
        Text(text)
            .font(.footnote.monospacedDigit())
            .foregroundStyle(PennyColor.secondaryLabel)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("This month, recorded: \(text)")
            .accessibilityIdentifier("calendar.totals")
    }
}

struct CalendarGrid: View {
    let calendar: CalendarMonth
    let selection: CalendarDate?
    let currency: String
    let today: CalendarDate
    let choose: (CalendarDate) -> Void
    @ScaledMetric(relativeTo: .body) private var cell = 44.0

    private static let weekdays = ["M", "T", "W", "T", "F", "S", "S"]
    private static let weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    var body: some View {
        Grid(horizontalSpacing: 0, verticalSpacing: 4) {
            GridRow {
                ForEach(0..<7, id: \.self) { index in
                    Text(Self.weekdays[index])
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(Self.weekdayNames[index])
                }
            }
            .accessibilityHidden(true)
            ForEach(Array(calendar.weeks.enumerated()), id: \.offset) { _, week in
                GridRow {
                    ForEach(0..<7, id: \.self) { index in
                        if let day = week[index] {
                            dayCell(day)
                        } else {
                            Color.clear.frame(maxWidth: .infinity, minHeight: cell).accessibilityHidden(true)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(MonthPicker.title(calendar.month, long: true)) calendar")
        .accessibilityIdentifier("calendar.grid")
    }

    private func dayCell(_ day: CalendarMonth.Day) -> some View {
        let isSelected = day.date == selection
        let isToday = day.date == today
        let isFuture = day.date > today
        return Button {
            choose(day.date)
        } label: {
            VStack(spacing: 3) {
                Text("\(day.date.day)")
                    .font(.body.weight(isSelected || isToday ? .bold : .regular).monospacedDigit())
                    .foregroundStyle(
                        isSelected
                            ? Color.white
                            : isToday ? PennyColor.tintText : isFuture ? PennyColor.tertiaryLabel : PennyColor.label
                    )
                    .frame(width: cell * 0.82, height: cell * 0.82)
                    .background(isSelected ? PennyColor.tint : Color.clear, in: Circle())
                CalendarMarkers(markers: day.markers)
            }
            .frame(maxWidth: .infinity, minHeight: cell)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OverviewText.calendarDay(day, currency: currency, today: today))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("calendar.day.\(day.date)")
    }
}

/// Dots in the meaning colors and an amber ring for expected or scheduled. The legend and each
/// day's spoken label say the same in words, so color is never the only cue.
struct CalendarMarkers: View {
    let markers: [CalendarMonth.Marker]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(markers, id: \.self) { marker in
                CalendarMarkerDot(marker: marker)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

struct CalendarMarkerDot: View {
    let marker: CalendarMonth.Marker

    var body: some View {
        switch marker {
        case .spent: Circle().fill(PennyColor.secondaryLabel).frame(width: 6, height: 6)
        case .income: Circle().fill(PennyColor.income).frame(width: 6, height: 6)
        case .invested: Circle().fill(PennyColor.invest).frame(width: 6, height: 6)
        case .scheduled: Circle().strokeBorder(PennyColor.pending, lineWidth: 1.5).frame(width: 7, height: 7)
        }
    }
}

struct CalendarLegend: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { items }
            VStack(alignment: .leading, spacing: 6) { items }
        }
        .font(.footnote)
        .foregroundStyle(PennyColor.secondaryLabel)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Legend: gray dot spent, green dot income, indigo dot invested, amber ring expected or scheduled"
        )
        .accessibilityIdentifier("calendar.legend")
    }

    @ViewBuilder
    private var items: some View {
        item(.spent, "Spent")
        item(.income, "Income")
        item(.invested, "Invested")
        item(.scheduled, "Expected or scheduled")
    }

    private func item(_ marker: CalendarMonth.Marker, _ title: String) -> some View {
        HStack(spacing: 5) {
            CalendarMarkerDot(marker: marker)
            Text(title).fixedSize()
        }
    }
}

/// The calendar at accessibility text sizes: one row per day that has entries.
struct CalendarDayList: View {
    let calendar: CalendarMonth
    let selection: CalendarDate?
    let currency: String
    let today: CalendarDate
    let choose: (CalendarDate) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if calendar.activeDays.isEmpty {
                Text("Nothing recorded or scheduled this month.").font(.body)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(calendar.activeDays) { day in
                Button {
                    choose(day.date)
                } label: {
                    HStack {
                        Text(OverviewText.calendarDay(day, currency: currency, today: today))
                            .font(.body)
                            .foregroundStyle(PennyColor.label)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        if day.date == selection {
                            Image(systemName: "checkmark").foregroundStyle(PennyColor.tintText)
                        }
                    }
                    .padding(.vertical, 10)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(day.date == selection ? .isSelected : [])
                .accessibilityIdentifier("calendar.day.\(day.date)")
                Divider()
            }
        }
        .accessibilityIdentifier("calendar.grid")
    }
}

/// The chosen day: its recorded net, what is expected or scheduled on it, and its entries.
struct DayDetail: View {
    let day: CalendarMonth.Day?
    let entries: [ReportEntry]
    let report: LedgerReport
    let currency: String
    let today: CalendarDate

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(DayText.long(day?.date ?? today, today: today).uppercased())
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if let day, day.recordedCount > 0 {
                    Text(MoneyFormat.signed(day.recordedNet, meaning: .neutral, currency: currency))
                        .font(.footnote.weight(.semibold).monospacedDigit())
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityLabel(
                            "Recorded net \(MoneyFormat.spoken(day.recordedNet, meaning: .neutral, currency: currency))"
                        )
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("calendar.dayTotal")
            if let day, day.scheduledCount > 0 {
                Label(
                    OverviewText.calendarPending(day.scheduledCount),
                    systemImage: "clock"
                )
                .font(.footnote)
                .foregroundStyle(PennyColor.pending)
                .fixedSize(horizontal: false, vertical: true)
            }
            EntryList(entries: entries, report: report, currency: currency, empty: "Nothing on this day.")
        }
        .accessibilityIdentifier("calendar.dayEntries")
    }
}
