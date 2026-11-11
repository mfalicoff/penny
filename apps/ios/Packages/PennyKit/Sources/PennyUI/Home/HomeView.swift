import Charts
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Home (`home`, `home-dark`, `empty-home`, `offline`, `saved-toast` cards; `ipad-home` in a
/// regular width). It leads with **Left to spend** (recorded) and, as a separate line,
/// **Projected** (recorded plus every scheduled occurrence), then the expected income behind
/// that projection, the compact Follow your money card, Recent activity, and Explore your
/// month (calendar, categories, money flow). The month picker and the settings button are
/// system toolbar controls, so they are Liquid Glass on iOS 26.
///
/// Every number comes from `LedgerReport.month` (docs/ios-overview.md): Left to spend and the
/// flow use recorded entries only; projected income and scheduled previews are never shown as
/// Activity or spending. Shared household rows count once, at the viewer's share.
struct HomeView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: Double = 0

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let summary = report.month(shell.month)
            let currency = ledger.currency.rawValue
            let dashboard = sizeClass == .regular && !typeSize.isAccessibilitySize && width >= 760
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SyncBanner()
                    DemoBanner()
                    SharedProjectionNotice()
                    if Self.isEmpty(ledger: ledger, report: report) {
                        EmptyHomeContent(currency: currency)
                    } else if dashboard {
                        HomeDashboard(report: report, summary: summary, currency: currency)
                    } else {
                        HomeHero(summary: summary, currency: currency)
                        ExpectedIncomeCard(summary: summary, currency: currency, today: shell.today)
                        FlowSummaryCard(flow: MoneyFlow(summary, categories: report.categories), currency: currency)
                        RecentSection(report: report, summary: summary)
                        ExploreSection(report: report, summary: summary, currency: currency)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: dashboard ? 1200 : 720)
                .frame(maxWidth: .infinity)
            }
            .onGeometryChange(for: Double.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .refreshable {
                await shell.workspace.reload()
                await shell.refreshShared()
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Home")
        .toolbarTitleDisplayModeInline()
        .toolbar {
            ToolbarItem(placement: .navigation) { MonthPicker() }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    shell.route.openSettings()
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                .accessibilityIdentifier("home.settings")
            }
        }
        .task(id: shell.month) { await shell.refreshShared() }
        .accessibilityIdentifier("screen.home")
    }

    /// Nothing at all yet: no entries, no schedules and no shared rows.
    static func isEmpty(ledger: Ledger, report: LedgerReport) -> Bool {
        report.recorded.isEmpty && ledger.recurring.isEmpty
    }

    /// The Projected line under the hero.
    static func projectedLine(_ summary: MonthSummary, currency: String, pending: Int) -> String {
        let amount = MoneyFormat.signed(summary.projectedRemaining, meaning: .neutral, currency: currency)
        if pending > 0 { return "\(amount) projected · as of last sync" }
        return summary.expectedIncome > 0 ? "\(amount) projected with expected pay" : "\(amount) projected"
    }

    /// What VoiceOver reads for the Projected line: what it includes, in words.
    static func projectedSpoken(_ summary: MonthSummary, currency: String) -> String {
        var text =
            "Projected remaining, \(MoneyFormat.spoken(summary.projectedRemaining, meaning: .neutral, currency: currency))"
        if summary.expectedIncome > 0 {
            text +=
                ", includes \(MoneyFormat.amount(summary.expectedIncome, currency: currency)) expected income not received yet"
        }
        if summary.scheduled.contains(where: { $0.kind != .income }) { text += ", and scheduled payments" }
        return text
    }
}

/// Left to spend (recorded) and Projected, two distinct lines.
struct HomeHero: View {
    @Environment(ShellModel.self) private var shell
    let summary: MonthSummary
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HeroAmount("Left to spend", cents: summary.recordedRemaining, currency: currency) {
                if summary.recordedRemaining < 0 {
                    Text(
                        "\(MoneyFormat.amount(-summary.recordedRemaining, currency: currency)) more went out than came in"
                    )
                    .fixedSize(horizontal: false, vertical: true)
                } else if summary.recorded == .zero {
                    Text("Nothing recorded this month yet.")
                }
            }
            .accessibilityIdentifier("home.hero")
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle().fill(PennyColor.pending).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(HomeView.projectedLine(summary, currency: currency, pending: shell.workspace.sync.pending))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(PennyFont.style(.subhead))
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(HomeView.projectedSpoken(summary, currency: currency))
            .accessibilityIdentifier("home.projected")
        }
        .padding(.top, 8)
    }
}

/// Income a schedule expects this month and hasn't recorded: named explicitly, because it is
/// in Projected but not in Left to spend. Hidden when no income is expected.
struct ExpectedIncomeCard: View {
    let summary: MonthSummary
    let currency: String
    let today: CalendarDate

    var body: some View {
        let expected = summary.scheduled.filter { $0.kind == .income }
        if !expected.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Expected income").font(.headline).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    MoneyText(summary.expectedIncome, meaning: .pending, currency: currency)
                }
                ForEach(expected) { entry in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.title).font(.subheadline.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            Text("\(DayText.short(entry.date, today: today)) · expected")
                                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        }
                        Spacer(minLength: 8)
                        MoneyText(
                            entry.share, meaning: .pending, currency: currency, style: .subheadline.weight(.semibold))
                    }
                    .accessibilityElement(children: .combine)
                }
                Text("Counted in Projected, not in Left to spend, until it's recorded.")
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .pennyCard()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("home.expectedIncome")
        }
    }
}

/// The compact "Follow your money" card: spent, invested and left as one bar and three
/// numbers. It opens the money flow page, which has the full chart and every value.
struct FlowSummaryCard: View {
    let flow: MoneyFlow
    let currency: String

    var body: some View {
        NavigationLink(value: DetailRoute.moneyFlow) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Follow your money").font(.headline).foregroundStyle(PennyColor.label)
                    Spacer()
                    Image(systemName: "chevron.forward").font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tertiaryLabel)
                }
                if flow.isEmpty {
                    Text("Nothing recorded this month yet.")
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                } else {
                    FlowBar(segments: [
                        (flow.expense, PennyColor.label.opacity(0.75)), (flow.investment, PennyColor.invest),
                        (flow.remaining, PennyColor.income),
                    ])
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top) { stats }
                        VStack(alignment: .leading, spacing: 10) { stats }
                    }
                }
            }
            .pennyCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Follow your money")
        .accessibilityValue(OverviewText.flowSummary(flow, currency: currency))
        .accessibilityHint("Shows where your money went")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("home.flow")
    }

    @ViewBuilder
    private var stats: some View {
        stat("Spent", flow.expense, PennyColor.label)
        Spacer(minLength: 12)
        stat("Invested", flow.investment, PennyColor.invest)
        Spacer(minLength: 12)
        if flow.gap > 0 {
            stat("Over", flow.gap, PennyColor.label)
        } else {
            stat("Left", flow.remaining, PennyColor.income)
        }
    }

    private func stat(_ title: String, _ cents: Int64, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            Text(MoneyFormat.amount(cents, currency: currency))
                .font(.headline.monospacedDigit())
                .foregroundStyle(color)
                .fixedSize()
        }
    }
}

/// A proportional bar; meaning is also given in text next to it, never by color alone.
struct FlowBar: View {
    let segments: [(Int64, Color)]

    var body: some View {
        let total = max(1, segments.reduce(0) { $0 + max(0, $1.0) })
        GeometryReader { proxy in
            HStack(spacing: 3) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    if segment.0 > 0 {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(segment.1)
                            .frame(width: max(4, proxy.size.width * Double(segment.0) / Double(total)))
                    }
                }
            }
        }
        .frame(height: 12)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityHidden(true)
    }
}

/// Recent activity of the month: recorded entries only (never a preview), newest first, with
/// "See all" opening Activity. A row opens the entry.
struct RecentSection: View {
    @Environment(ShellModel.self) private var shell
    let report: LedgerReport
    let summary: MonthSummary

    var body: some View {
        let entries = Self.recent(summary)
        VStack(alignment: .leading, spacing: 8) {
            OverviewHeader(title: "Recent") {
                Button("See all") { shell.route.select(.activity) }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PennyColor.tintText)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityLabel("See all activity")
            }
            EntryList(
                entries: entries, report: report, currency: report.ledger.currency.rawValue,
                empty: "Nothing this month yet. New entries show up here.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.recent")
    }

    /// The five newest recorded entries of the month.
    static func recent(_ summary: MonthSummary) -> [ReportEntry] {
        Array(summary.recordedEntries.sorted(by: ReportEntry.chronological).prefix(5))
    }
}

/// "Explore your month": the calendar, spending by category and the money flow, each a page of
/// the Home stack with a one-line preview of what it holds.
struct ExploreSection: View {
    let report: LedgerReport
    let summary: MonthSummary
    let currency: String

    var body: some View {
        let calendar = CalendarMonth(summary)
        let breakdown = CategoryBreakdown(summary)
        let flow = MoneyFlow(summary, categories: report.categories)
        VStack(alignment: .leading, spacing: 8) {
            OverviewHeader("Explore your month")
            VStack(spacing: 0) {
                row(
                    .calendar, "Calendar", "calendar", Self.calendarLine(calendar)
                )
                .accessibilityIdentifier("home.exploreCalendar")
                Divider().padding(.leading, 64)
                row(
                    .insights, "Spending by category", "chart.pie", Self.categoriesLine(breakdown, currency: currency)
                )
                .accessibilityIdentifier("home.exploreInsights")
                Divider().padding(.leading, 64)
                row(
                    .moneyFlow, "Money flow", "arrow.triangle.branch",
                    flow.isEmpty
                        ? "Nothing recorded yet"
                        : "Came in \(OverviewText.money(flow.income, currency)) · went out \(OverviewText.money(flow.outflow, currency))"
                )
                .accessibilityIdentifier("home.exploreMoneyFlow")
            }
            .background(
                PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.explore")
    }

    static func calendarLine(_ calendar: CalendarMonth) -> String {
        let recorded = calendar.days.filter { $0.recordedCount > 0 }.count
        let scheduled = calendar.days.reduce(0) { $0 + $1.scheduledCount }
        var parts = [recorded == 1 ? "1 day with entries" : "\(recorded) days with entries"]
        if scheduled > 0 { parts.append("\(scheduled) scheduled") }
        return parts.joined(separator: " · ")
    }

    static func categoriesLine(_ breakdown: CategoryBreakdown, currency: String) -> String {
        guard let top = breakdown.rows.first else { return "No spending yet" }
        return "Mostly \(top.category.name) · \(top.percent)"
    }

    private func row(_ route: DetailRoute, _ title: String, _ symbol: String, _ detail: String)
        -> some View
    {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                CategoryIcon(symbol: symbol, color: PennyColor.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward").font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel).accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: ControlSize.row)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

/// The month in the toolbar: the current month and the eleven before it.
struct MonthPicker: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        @Bindable var shell = shell
        Menu {
            Picker("Month", selection: $shell.month) {
                ForEach(Self.months(through: MonthKey(shell.today)), id: \.self) { month in
                    Text(Self.title(month, long: true)).tag(month)
                }
            }
        } label: {
            Label {
                Text(Self.title(shell.month, long: false))
            } icon: {
                Image(systemName: "chevron.down")
            }
            .labelStyle(.titleOnly)
        }
        .accessibilityLabel("Month, \(Self.title(shell.month, long: true))")
        .accessibilityIdentifier("home.month")
    }

    static func months(through last: MonthKey) -> [MonthKey] {
        (0..<12).compactMap { last.shifted(by: -$0) }
    }

    static func title(_ month: MonthKey, long: Bool) -> String {
        var parts = DateComponents()
        parts.year = month.year
        parts.month = month.month
        parts.day = 1
        guard let date = Calendar(identifier: .gregorian).date(from: parts) else { return month.description }
        return date.formatted(long ? .dateTime.month(.wide).year() : .dateTime.month(.wide))
    }
}

/// The empty Home (`empty-home` card): $0, how to start, and the demo.
struct EmptyHomeContent: View {
    @Environment(ShellModel.self) private var shell
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HeroAmount("Left to spend", cents: 0, currency: currency) {
                Text("Your month fills in as you add entries.")
            }
            .padding(.top, 8)
            VStack(alignment: .leading, spacing: 12) {
                Text("Add your first entry").font(.headline)
                Text("Start with what came in this month, then what went out.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                PennyButton("Add entry", systemImage: "plus") { shell.route.openAddEntry() }
                    .accessibilityIdentifier("emptyHome.add")
            }
            .pennyCard()
            if let startDemo = shell.startDemo {
                Button(action: startDemo) {
                    HStack(spacing: 12) {
                        CategoryIcon(symbol: "play.fill", color: PennyColor.tint)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Try with sample data").font(.headline).foregroundStyle(PennyColor.label)
                            Text("Explore first. Nothing is saved.")
                                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        }
                        Spacer()
                        Image(systemName: "chevron.forward").foregroundStyle(PennyColor.tertiaryLabel)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .pennyCard()
                .accessibilityIdentifier("emptyHome.demo")
            }
            VStack(alignment: .leading, spacing: 8) {
                OverviewHeader("Recent")
                Text("Nothing yet. New entries show up here.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .pennyCard()
            }
        }
        .accessibilityIdentifier("home.empty")
    }
}

// MARK: - iPad

/// Home in a wide regular width (`ipad-home`, adapted from the `desktop` reference): the hero
/// with Income, Spent and Invested beside Coming up, then the full money flow beside daily
/// spending and Explore your month, then Recent.
struct HomeDashboard: View {
    @Environment(ShellModel.self) private var shell
    let report: LedgerReport
    let summary: MonthSummary
    let currency: String
    @State private var focused: String?

    var body: some View {
        let flow = MoneyFlow(summary, categories: report.categories)
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 16) {
                    HomeHero(summary: summary, currency: currency)
                    KindTotalsRow(totals: summary.recorded, currency: currency)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ComingUpPanel(summary: summary, currency: currency, today: shell.today)
                    .frame(width: 340)
            }
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    OverviewHeader(title: "Follow your money") {
                        NavigationLink(value: DetailRoute.moneyFlow) {
                            Text("Details").font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.tintText)
                        }
                        .accessibilityLabel("Money flow details")
                        .accessibilityIdentifier("home.flow")
                    }
                    if flow.isEmpty {
                        Text("Nothing recorded this month yet.")
                            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    } else {
                        Text("Tap a band to focus").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        SankeyChart(flow: flow, currency: currency, focused: $focused)
                        if let id = focused, let node = flow.node(id: id) {
                            FlowFocusCard(node: node, flow: flow, report: report, currency: currency) { focused = nil }
                        }
                    }
                }
                .pennyCard()
                .frame(maxWidth: .infinity)
                VStack(alignment: .leading, spacing: 20) {
                    DailySpendingPanel(summary: summary, currency: currency, today: shell.today)
                    ExploreSection(report: report, summary: summary, currency: currency)
                }
                .frame(width: 340)
            }
            RecentSection(report: report, summary: summary)
        }
        .onChange(of: shell.month) { focused = nil }
    }
}

/// Income, Spent · your share and Invested (recorded), each named in text.
struct KindTotalsRow: View {
    let totals: KindTotals
    let currency: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 18) { items }
            VStack(alignment: .leading, spacing: 6) { items }
        }
        .font(.subheadline)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.totals")
    }

    @ViewBuilder
    private var items: some View {
        item("Income", totals.income, PennyColor.income)
        item("Spent · your share", totals.expense, PennyColor.secondaryLabel)
        item("Invested", totals.investment, PennyColor.invest)
    }

    private func item(_ title: String, _ cents: Int64, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
            Text(title).foregroundStyle(PennyColor.secondaryLabel)
            Text(MoneyFormat.amount(cents, currency: currency)).font(.subheadline.weight(.semibold).monospacedDigit())
        }
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}

/// Scheduled occurrences from today to the end of the month (recurring rules, personal and
/// shared). Income is marked expected; nothing here is recorded yet.
struct ComingUpPanel: View {
    let summary: MonthSummary
    let currency: String
    let today: CalendarDate

    var body: some View {
        let upcoming = Array(summary.scheduled.filter { $0.date >= today }.prefix(5))
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Coming up").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                Text("Recurring").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            if upcoming.isEmpty {
                Text("Nothing else scheduled this month.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(upcoming) { entry in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title).font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(
                            "\(DayText.short(entry.date, today: today))\(entry.kind == .income ? " · expected" : "")"
                        )
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    Spacer(minLength: 8)
                    MoneyText(
                        entry.share, meaning: entry.kind == .income ? .pending : EntryRow.meaning(entry),
                        currency: currency, style: .subheadline.weight(.semibold))
                }
                .accessibilityElement(children: .combine)
            }
        }
        .pennyCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.comingUp")
    }
}

/// Recorded spending per day as bars, with the daily average in text (and for VoiceOver).
struct DailySpendingPanel: View {
    let summary: MonthSummary
    let currency: String
    let today: CalendarDate

    var body: some View {
        let calendar = CalendarMonth(summary)
        let average = calendar.averageDailySpending(today: today)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Daily spending").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                if let average {
                    Text("Avg \(MoneyFormat.amount(average, currency: currency))")
                        .font(.footnote.monospacedDigit()).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            Chart(calendar.days) { day in
                BarMark(x: .value("Day", day.date.day), y: .value("Spent", Double(day.spent) / 100))
                    .foregroundStyle(PennyColor.tint)
                    .accessibilityLabel(DayText.date(day.date).formatted(.dateTime.month(.wide).day()))
                    .accessibilityValue(MoneyFormat.amount(day.spent, currency: currency))
            }
            .chartYAxis(.hidden)
            .chartXAxis { AxisMarks(values: [1, 15, calendar.days.count]) }
            .frame(height: 140)
        }
        .pennyCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.dailySpending")
    }
}
