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
/// Every number comes from `LedgerReport.month` (docs/ios/overview.md): Left to spend and the
/// flow use recorded entries only; projected income and scheduled previews are never shown as
/// Activity or spending. Shared household rows count once, at the viewer's share.
struct HomeView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: Double = 0
    /// The toolbar calendar is for a month with something in it; the empty Home has none.
    @State private var hasEntries = false

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            // Income dated after today counts toward Projected, not Left to spend (MAZ-136).
            let summary = report.month(shell.month, today: shell.today)
            let currency = ledger.currency.rawValue
            let dashboard = sizeClass == .regular && !typeSize.isAccessibilitySize && width >= 760
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SyncBanner()
                    DemoBanner()
                    SharedProjectionNotice()
                    ReceiptInboxHomeRow()
                    if Self.isEmpty(ledger: ledger, report: report) {
                        EmptyHomeContent(currency: currency)
                    } else if dashboard {
                        HomeDashboard(report: report, summary: summary, currency: currency, width: width)
                    } else {
                        HomeHero(summary: summary, currency: currency)
                        ExpectedIncomeCard(summary: summary, currency: currency, today: shell.today)
                        FlowSummaryCard(flow: MoneyFlow(summary, categories: report.categories), currency: currency)
                        RecentSection(report: report, summary: summary)
                        ExploreSection(report: report, summary: summary, currency: currency)
                    }
                }
                // The tinted glow behind the hero (MAZ-180), dimmed on the empty Home as on its card.
                .heroGlow(opacity: Self.isEmpty(ledger: ledger, report: report) ? 0.6 : 1)
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: dashboard ? 1200 : 720)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: Self.isEmpty(ledger: ledger, report: report), initial: true) { _, empty in
                hasEntries = !empty
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
            if sizeClass == .regular {
                // iPad (`ipad-home` card): the month between back and forward arrows, then
                // search and the copper Add entry capsule. Settings is in the sidebar's footer.
                ToolbarItem(placement: .navigation) { MonthStepButton(offset: -1) }
                ToolbarSpacer(.fixed, placement: .navigation)
                ToolbarItem(placement: .navigation) { MonthPicker(showsYear: true) }
                ToolbarSpacer(.fixed, placement: .navigation)
                ToolbarItem(placement: .navigation) { MonthStepButton(offset: 1) }
            } else {
                ToolbarItem(placement: .navigation) { MonthPicker() }
            }
            if hasEntries {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink(value: DetailRoute.calendar) {
                        Label("Calendar", systemImage: "calendar")
                    }
                    .accessibilityIdentifier("home.calendar")
                }
            }
            if sizeClass == .regular {
                ToolbarSpacer(.fixed, placement: .primaryAction)
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        shell.openActivitySearch()
                    } label: {
                        Label("Search activity", systemImage: "magnifyingglass")
                    }
                    .accessibilityIdentifier("home.search")
                }
                ToolbarSpacer(.fixed, placement: .primaryAction)
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        shell.route.openAddEntry()
                    } label: {
                        // An HStack, not a Label: the toolbar would draw a Label as its icon alone.
                        HStack(spacing: 6) {
                            Image(systemName: "plus")
                            Text("Add entry")
                        }
                        .fontWeight(.semibold)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(PennyColor.tint)
                    .accessibilityIdentifier("home.add")
                }
            } else {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        shell.route.openSettings()
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .accessibilityIdentifier("home.settings")
                }
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
        let parts = projectedParts(summary, currency: currency, pending: pending)
        return parts.amount + parts.rest
    }

    /// The Projected line in two parts, so the amount is drawn bold as on the cards
    /// ("**$3,366.65** projected with expected pay").
    static func projectedParts(_ summary: MonthSummary, currency: String, pending: Int)
        -> (amount: String, rest: String)
    {
        let amount = MoneyFormat.signed(summary.projectedRemaining, meaning: .neutral, currency: currency)
        if pending > 0 { return (amount, " projected · as of last sync") }
        return (amount, summary.expectedIncome > 0 ? " projected with expected pay" : " projected")
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
                let parts = HomeView.projectedParts(summary, currency: currency, pending: shell.workspace.sync.pending)
                let amount = Text(parts.amount).fontWeight(.semibold).monospacedDigit()
                    .foregroundStyle(PennyColor.label)
                Text("\(amount)\(parts.rest)")
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
        // Scheduled income plus income dated after today (MAZ-136): the parts of `expectedIncome`.
        let expected = (summary.expected + summary.scheduled).filter { $0.kind == .income }
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
                HStack(spacing: 4) {
                    Text("Follow your money").font(.headline).foregroundStyle(PennyColor.label)
                    Image(systemName: "chevron.forward").font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tertiaryLabel)
                    Spacer(minLength: 0)
                }
                if flow.isEmpty {
                    Text("Nothing recorded this month yet.")
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                } else {
                    FlowBar(segments: [
                        (flow.expense, PennyColor.label.opacity(0.75)), (flow.investment, PennyColor.invest),
                        (flow.remaining, PennyColor.income),
                    ])
                    // The cards' one-line legend under the bar, so the totals never compete with
                    // the hero; it stacks only when the line doesn't fit (large text).
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 14) { legend }
                        VStack(alignment: .leading, spacing: 6) { legend }
                    }
                    .font(.footnote)
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
    private var legend: some View {
        LegendItem(title: "Spent", amount: MoneyFormat.whole(flow.expense, currency: currency), dot: Self.spentColor)
        LegendItem(
            title: "Invested", amount: MoneyFormat.whole(flow.investment, currency: currency), dot: PennyColor.invest)
        if flow.gap > 0 {
            LegendItem(title: "Over", amount: MoneyFormat.whole(flow.gap, currency: currency), dot: Self.spentColor)
        } else {
            LegendItem(
                title: "Left", amount: MoneyFormat.whole(flow.remaining, currency: currency), dot: PennyColor.income)
        }
    }

    /// Spending's gray, the same as its band in the bar.
    static let spentColor = PennyColor.label.opacity(0.75)
}

/// One item of a dot legend (the cards' `.legend`): a meaning-colored dot, the name in the
/// secondary label color and the amount in the label color, semibold. The dot is decoration;
/// the name says what the amount is.
struct LegendItem: View {
    let title: String
    let amount: String
    let dot: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 8, height: 8).accessibilityHidden(true)
            Text(title).foregroundStyle(PennyColor.secondaryLabel)
            Text(amount).fontWeight(.semibold).monospacedDigit().foregroundStyle(PennyColor.label)
        }
        .fixedSize()
        .accessibilityElement(children: .combine)
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
        if scheduled > 0 { parts.append("\(scheduled) expected or scheduled") }
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

/// The month in the toolbar: the current month and the eleven before it. As on the cards it is
/// "November ⌄" in the label color (copper is for actions); `showsYear` gives iPad Home's
/// "November 2026 ⌄".
struct MonthPicker: View {
    @Environment(ShellModel.self) private var shell
    var showsYear = false

    var body: some View {
        @Bindable var shell = shell
        Menu {
            Picker("Month", selection: $shell.month) {
                ForEach(Self.months(through: MonthKey(shell.today)), id: \.self) { month in
                    Text(Self.title(month, long: true)).tag(month)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(Self.title(shell.month, long: showsYear))
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(PennyColor.label)
        }
        .tint(PennyColor.label)
        .accessibilityLabel("Month, \(Self.title(shell.month, long: true))")
        .accessibilityIdentifier("home.month")
    }

    static func months(through last: MonthKey) -> [MonthKey] {
        (0..<12).compactMap { last.shifted(by: -$0) }
    }

    /// The month before or after `month` that the picker offers, or nil at either end.
    static func step(_ month: MonthKey, by offset: Int, through last: MonthKey) -> MonthKey? {
        guard let next = month.shifted(by: offset), months(through: last).contains(next) else { return nil }
        return next
    }
}

/// iPad Home's back and forward arrows around the month (`ipad-home` card). They move within
/// the months the picker offers, and are disabled at either end.
struct MonthStepButton: View {
    @Environment(ShellModel.self) private var shell
    let offset: Int

    var body: some View {
        let next = MonthPicker.step(shell.month, by: offset, through: MonthKey(shell.today))
        Button {
            if let next { shell.month = next }
        } label: {
            Label(
                offset < 0 ? "Previous month" : "Next month",
                systemImage: offset < 0 ? "chevron.backward" : "chevron.forward")
        }
        .tint(PennyColor.label)
        .disabled(next == nil)
        .accessibilityIdentifier(offset < 0 ? "home.previousMonth" : "home.nextMonth")
    }
}

extension MonthPicker {

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
            // A dimmed "$0", with no cents: nothing is in the month yet.
            HeroAmount("Left to spend", cents: 0, currency: currency, dimmed: true) {
                Text("Your month fills in as you add entries.")
            }
            .padding(.top, 8)
            VStack(alignment: .leading, spacing: 4) {
                Text("Add your first entry").font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
                Text("Start with what came in this month, then what went out.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                EmptyHomeKinds()
                    .padding(.top, 14)
            }
            .pennyCard()
            if let startDemo = shell.startDemo {
                Button(action: startDemo) {
                    HStack(spacing: 12) {
                        Image(systemName: "play.fill").font(.title3).foregroundStyle(PennyColor.tint)
                            .accessibilityHidden(true)
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
                // The card's empty list: a centered list icon and one line, with no surface.
                VStack(spacing: 8) {
                    Image(systemName: "list.bullet").font(.title).foregroundStyle(PennyColor.tertiaryLabel)
                        .accessibilityHidden(true)
                    Text("Nothing yet. New entries show up here.")
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .accessibilityIdentifier("home.empty")
    }
}

/// The empty Home's Income, Expense and Invest tiles: each opens Add entry on that kind. Three
/// in a row, as on the card; stacked at accessibility text sizes.
struct EmptyHomeKinds: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        layout {
            tile(.income, "Income", "Pay, refunds", "arrow.down", PennyColor.income, .white)
                .accessibilityIdentifier("emptyHome.income")
            tile(.expense, "Expense", "Spending", "arrow.up", PennyColor.label, PennyColor.surface)
                .accessibilityIdentifier("emptyHome.expense")
            tile(.investment, "Invest", "Contributions", "chart.line.uptrend.xyaxis", PennyColor.invest, .white)
                .accessibilityIdentifier("emptyHome.invest")
        }
    }

    private func tile(
        _ kind: EntryKind, _ title: String, _ detail: String, _ symbol: String, _ color: Color, _ glyph: Color
    ) -> some View {
        Button {
            shell.openAddEntry(kind: kind)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                CategoryIcon(symbol: symbol, color: color, glyph: glyph, size: 34)
                    .padding(.bottom, 10)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.label)
                Text(detail).font(.caption.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                    .padding(.top, 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // On the solid start card the tiles take the page color, so each reads as its own button.
            .background(PennyColor.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Add \(title.lowercased())")
        .accessibilityValue(detail)
        .accessibilityAddTraits(.isButton)
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
    /// The scroll view's width, for the side column.
    let width: Double
    @State private var focused: String?

    var body: some View {
        let flow = MoneyFlow(summary, categories: report.categories)
        let side = Self.sideWidth(width)
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 16) {
                    HomeHero(summary: summary, currency: currency)
                    KindTotalsRow(totals: summary.recorded, currency: currency)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ComingUpPanel(summary: summary, categories: report.categories, currency: currency, today: shell.today)
                    .frame(width: side)
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
                .frame(width: side)
            }
            RecentSection(report: report, summary: summary)
        }
        .onChange(of: shell.month) { focused = nil }
    }

    /// The side column (Coming up, daily spending): the card's third column, 1 of 3.15 parts
    /// of the content beside the hero's 2.15, so Income, Spent and Invested fit on one line
    /// under the hero. Never narrower than 260pt, so a row's title and amount still fit.
    static func sideWidth(_ width: Double) -> Double {
        let content = min(max(0, width - 2 * Metrics.gutter), 1200)
        return max(260, ((content - 20) / 3.15).rounded())
    }
}

/// Income, Spent · your share and Invested (recorded), each named in text.
struct KindTotalsRow: View {
    let totals: KindTotals
    let currency: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { items }
            VStack(alignment: .leading, spacing: 6) { items }
        }
        .font(.subheadline)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.totals")
    }

    @ViewBuilder
    private var items: some View {
        LegendItem(
            title: "Income", amount: MoneyFormat.amount(totals.income, currency: currency), dot: PennyColor.income)
        LegendItem(
            title: "Spent · your share", amount: MoneyFormat.amount(totals.expense, currency: currency),
            dot: FlowSummaryCard.spentColor)
        LegendItem(
            title: "Invested", amount: MoneyFormat.amount(totals.investment, currency: currency), dot: PennyColor.invest
        )
    }
}

/// Everything in Projected that is not in Left to spend yet, soonest first: income dated after
/// today (MAZ-136) and the month's scheduled occurrences (recurring rules, personal and shared),
/// the iPad's counterpart of the iPhone's Expected income card. A preview dated before today
/// (not materialized yet: offline, or a shared rule the server hasn't recorded) still counts
/// in Projected, so it is listed too; the panel never hides money Projected counts.
struct ComingUpPanel: View {
    let summary: MonthSummary
    let categories: [LedgerCategory]
    let currency: String
    let today: CalendarDate

    static let limit = 6

    /// `summary.expected` and `summary.scheduled`, oldest date first, then id.
    static func rows(_ summary: MonthSummary) -> [ReportEntry] {
        (summary.expected + summary.scheduled).sorted {
            $0.date != $1.date ? $0.date < $1.date : $0.id.utf16.lexicographicallyPrecedes($1.id.utf16)
        }
    }

    /// "Nov 15 · expected" for income, "Nov 18" for a scheduled payment, as on the card: the
    /// panel's "Recurring" says the rest, and VoiceOver hears each amount as expected.
    static func detail(_ entry: ReportEntry, today: CalendarDate) -> String {
        let day = DayText.short(entry.date, today: today)
        return entry.kind == .income ? "\(day) · expected" : day
    }

    /// The rows past `limit`, in words with their net, so nothing counted is out of sight.
    static func more(_ rows: [ReportEntry], currency: String) -> String? {
        let hidden = rows.dropFirst(limit)
        guard !hidden.isEmpty else { return nil }
        let net = hidden.reduce(Int64(0)) { $0 + ($1.kind == .income ? $1.share : -$1.share) }
        return "\(hidden.count) more · \(MoneyFormat.signed(net, meaning: .neutral, currency: currency))"
    }

    var body: some View {
        let rows = Self.rows(summary)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Coming up").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                Text("Recurring").font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            if rows.isEmpty {
                Text("Nothing expected or scheduled this month.")
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(rows.prefix(Self.limit)) { entry in
                let category = categories.first { $0.id == entry.categoryId }
                HStack(spacing: 12) {
                    CategoryIcon(
                        symbol: EntryText.tileSymbol(entry.kind, category: category),
                        color: EntryText.tileColor(entry.kind, category: category, id: entry.categoryId), size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title).font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(Self.detail(entry, today: today))
                            .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    Spacer(minLength: 8)
                    // Signed in its kind's color, as on the card; the detail line and the spoken
                    // amount say it hasn't happened yet.
                    let meaning = Self.meaning(entry)
                    Text(MoneyFormat.signed(entry.share, meaning: meaning, currency: currency))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(meaning.color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityLabel(MoneyFormat.spoken(entry.share, meaning: .pending, currency: currency))
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
            }
            if let more = Self.more(rows, currency: currency) {
                Text(more).font(.footnote).monospacedDigit().foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .pennyCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.comingUp")
    }

    /// A row's amount takes its kind's sign and color (green "+$2,250.00", "−$65.00" in the
    /// label color, indigo for a contribution), not the amber of pending.
    static func meaning(_ entry: ReportEntry) -> MoneyMeaning {
        switch entry.kind {
        case .expense: .expense
        case .income: .income
        case .investment: .investment
        }
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
