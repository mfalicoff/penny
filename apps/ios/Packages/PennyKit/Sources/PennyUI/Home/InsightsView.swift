import Charts
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Insights (`insights` card): the month's spending as a donut with the total in the middle,
/// one sentence comparing it with last month, and the categories with their shares. A row
/// opens that category's entries. Spending is recorded expenses at your share; income and
/// investment contributions are not spending and never appear here.
struct InsightsView: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let summary = report.month(shell.month)
            let breakdown = CategoryBreakdown(summary)
            let currency = ledger.currency.rawValue
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Spending · your share").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    if breakdown.isEmpty {
                        PennyStateView(
                            .empty, title: "No spending in \(MonthPicker.title(shell.month, long: false))",
                            message: summary.recorded.income > 0 || summary.recorded.investment > 0
                                ? "Income and contributions were recorded, but nothing was spent."
                                : "Spending shows up here once you add an expense.")
                    } else {
                        SpendingCard(
                            breakdown: breakdown, comparison: report.comparison(summary), currency: currency)
                        CategoryList(breakdown: breakdown, report: report, currency: currency)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Insights")
        .toolbarTitleDisplayModeLarge()
        .overviewToolbar()
        .accessibilityIdentifier("screen.insights")
    }
}

/// The donut, the month-over-month sentence and the two comparison bars.
struct SpendingCard: View {
    let breakdown: CategoryBreakdown
    let comparison: MonthComparison
    let currency: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 20))
        layout {
            donut
            VStack(alignment: .leading, spacing: 8) {
                Text(OverviewText.comparison(comparison, currency: currency))
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("insights.comparison")
                if let top = OverviewText.topCategories(breakdown) {
                    Text(top).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let previous = comparison.previousMonth {
                    ComparisonBars(
                        current: comparison.current, previous: comparison.previous,
                        currentTitle: MonthPicker.title(previous.shifted(by: 1) ?? previous, long: false),
                        previousTitle: MonthPicker.title(previous, long: false), currency: currency)
                }
            }
        }
        .pennyCard()
    }

    private var donut: some View {
        Chart(breakdown.rows) { row in
            SectorMark(angle: .value("Amount", row.amount), innerRadius: .ratio(0.72), angularInset: 1)
                .foregroundStyle(PennyColor.category(row.category.paletteColor))
                .accessibilityLabel(row.category.name)
                .accessibilityValue(
                    "\(MoneyFormat.amount(row.amount, currency: currency)), \(row.percent) of spending")
        }
        .chartLegend(.hidden)
        .frame(width: 130, height: 130)
        .overlay {
            VStack(spacing: 0) {
                Text(MoneyFormat.amount(breakdown.total, currency: currency))
                    .font(.headline.monospacedDigit())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text("SPENT").font(.caption2.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
            }
            .padding(24)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Spending by category, \(MoneyFormat.amount(breakdown.total, currency: currency)) spent")
        .accessibilityIdentifier("insights.donut")
    }
}

/// This month and last month's spending as two bars on one scale, with the amounts in text.
struct ComparisonBars: View {
    let current: Int64
    let previous: Int64
    let currentTitle: String
    let previousTitle: String
    let currency: String

    var body: some View {
        let scale = Double(max(current, previous, 1))
        VStack(alignment: .leading, spacing: 6) {
            bar(currentTitle, current, scale: scale, color: PennyColor.label.opacity(0.75))
            bar(previousTitle, previous, scale: scale, color: PennyColor.tertiaryLabel)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(currentTitle) \(MoneyFormat.amount(current, currency: currency)), \(previousTitle) \(MoneyFormat.amount(previous, currency: currency))"
        )
    }

    private func bar(_ title: String, _ cents: Int64, scale: Double, color: Color) -> some View {
        HStack(spacing: 8) {
            GeometryReader { proxy in
                Capsule().fill(color).frame(width: max(6, proxy.size.width * Double(cents) / scale))
            }
            .frame(height: 8)
            Text(title).font(.footnote).foregroundStyle(PennyColor.secondaryLabel).fixedSize()
        }
    }
}

/// The categories, largest first. Each row opens that category's entries for the month.
struct CategoryList: View {
    let breakdown: CategoryBreakdown
    let report: LedgerReport
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            OverviewHeader("Categories")
            VStack(spacing: 0) {
                ForEach(breakdown.rows) { row in
                    NavigationLink(
                        value: DetailRoute.categorySpending(categoryIds: [row.category.id], title: row.category.name)
                    ) {
                        CategoryShareRow(row: row, currency: currency)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("insights.category.\(OverviewText.identifier(row.category.id))")
                    if row.id != breakdown.rows.last?.id { Divider().padding(.leading, 64) }
                }
            }
            .background(
                PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
    }
}

struct CategoryShareRow: View {
    let row: CategoryBreakdown.Row
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: CategoryStyle.symbol(forIonicon: row.category.icon),
                color: PennyColor.category(row.category.paletteColor))
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.category.name).font(.body.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(MoneyFormat.amount(row.amount, currency: currency))
                            .font(.body.weight(.semibold).monospacedDigit())
                            .fixedSize()
                        Text(row.percent).font(.footnote.monospacedDigit())
                            .foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(PennyColor.fill)
                        Capsule().fill(PennyColor.category(row.category.paletteColor))
                            .frame(width: max(4, proxy.size.width * row.fraction))
                    }
                }
                .frame(height: 5)
                .accessibilityHidden(true)
            }
            Image(systemName: "chevron.forward").font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.tertiaryLabel).accessibilityHidden(true)
        }
        .foregroundStyle(PennyColor.label)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: ControlSize.row)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(row.category.name), \(MoneyFormat.amount(row.amount, currency: currency)), \(row.percent) of spending"
        )
        .accessibilityAddTraits(.isButton)
    }
}

/// One category's entries in the month (recorded and scheduled), opened from Insights. The
/// list is a filter: the month's totals on Home and Insights don't change.
struct CategorySpendingView: View {
    @Environment(ShellModel.self) private var shell
    let categoryIds: [String]
    let title: String

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let summary = report.month(shell.month)
            let entries = report.categoryEntries(summary, categoryIds: categoryIds)
            let recorded = entries.filter { !$0.scheduled && $0.kind == .expense }.reduce(Int64(0)) { $0 + $1.share }
            let currency = ledger.currency.rawValue
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Spent · your share").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        Text(MoneyFormat.amount(recorded, currency: currency))
                            .font(.largeTitle.weight(.bold).monospacedDigit())
                        if let share = Percent.text(recorded, of: summary.recorded.expense) {
                            Text(
                                "\(share) of \(MoneyFormat.amount(summary.recorded.expense, currency: currency)) spent this month"
                            )
                            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("categorySpending.total")
                    EntryList(entries: entries, report: report, currency: currency, empty: "No entries this month.")
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .background(PennyColor.background)
        .navigationTitle(title)
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.categorySpending")
    }
}

/// Rows of entries on a solid surface. Recorded rows open their detail; a scheduled row is a
/// preview and says so.
struct EntryList: View {
    let entries: [ReportEntry]
    let report: LedgerReport
    let currency: String
    let empty: String

    var body: some View {
        if entries.isEmpty {
            Text(empty)
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .pennyCard()
        } else {
            LazyVStack(spacing: 0) {
                ForEach(entries) { entry in
                    if entry.scheduled {
                        EntryRow(entry: entry, report: report, currency: currency)
                    } else {
                        NavigationLink(value: ActivityRoute.destination(entry)) {
                            EntryRow(entry: entry, report: report, currency: currency)
                        }
                        .buttonStyle(.plain)
                    }
                    if entry.id != entries.last?.id { Divider().padding(.leading, 64) }
                }
            }
            .background(
                PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
    }
}
