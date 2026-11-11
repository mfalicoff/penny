import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Home (`home`, `empty-home`, `offline`, `saved-toast` cards): Left to spend as the hero,
/// Projected under it, the Follow your money card and Recent. The month picker and the
/// settings button are system toolbar controls, so they are Liquid Glass on iOS 26.
struct HomeView: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        WorkspaceContent { ledger in
            let report = LedgerReport(ledger: ledger)
            // Income dated after today counts toward Projected, not Left to spend (MAZ-136).
            let summary = report.month(shell.month, today: shell.today)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SyncBanner()
                    DemoBanner()
                    if ledger.transactions.isEmpty && ledger.recurring.isEmpty {
                        EmptyHomeContent(currency: ledger.currency.rawValue)
                    } else {
                        hero(summary, currency: ledger.currency.rawValue)
                        FlowSummaryCard(summary: summary, currency: ledger.currency.rawValue)
                        RecentSection(report: report, summary: summary)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await shell.workspace.reload() }
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
        .accessibilityIdentifier("screen.home")
    }

    private func hero(_ summary: MonthSummary, currency: String) -> some View {
        HeroAmount("Left to spend", cents: summary.recordedRemaining, currency: currency) {
            HStack(spacing: 6) {
                Circle().fill(PennyColor.pending).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(Self.projectedLine(summary, currency: currency, pending: shell.workspace.sync.pending))
            }
        }
        .padding(.top, 8)
        .accessibilityIdentifier("home.hero")
    }

    static func projectedLine(_ summary: MonthSummary, currency: String, pending: Int) -> String {
        let amount = MoneyFormat.signed(summary.projectedRemaining, meaning: .neutral, currency: currency)
        if pending > 0 { return "\(amount) projected · as of last sync" }
        return summary.expectedIncome > 0 ? "\(amount) projected with expected pay" : "\(amount) projected"
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

/// "Follow your money": spent, invested and left as one bar and three numbers. The money flow
/// screen it opens arrives with MAZ-77.
struct FlowSummaryCard: View {
    let summary: MonthSummary
    let currency: String

    var body: some View {
        let spent = summary.recorded.expense
        let invested = summary.recorded.investment
        let left = max(0, summary.recordedRemaining)
        VStack(alignment: .leading, spacing: 14) {
            Text("Follow your money").font(.headline)
            FlowBar(segments: [
                (spent, PennyColor.label.opacity(0.75)), (invested, PennyColor.invest), (left, PennyColor.income),
            ])
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top) { stats(spent: spent, invested: invested, left: left) }
                VStack(alignment: .leading, spacing: 10) { stats(spent: spent, invested: invested, left: left) }
            }
        }
        .pennyCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.flow")
    }

    @ViewBuilder
    private func stats(spent: Int64, invested: Int64, left: Int64) -> some View {
        stat("Spent", spent, .expense)
        Spacer(minLength: 12)
        stat("Invested", invested, .investment)
        Spacer(minLength: 12)
        stat("Left", summary.recordedRemaining, summary.recordedRemaining >= 0 ? .income : .neutral)
    }

    private func stat(_ title: String, _ cents: Int64, _ meaning: MoneyMeaning) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            Text(MoneyFormat.signed(cents, meaning: meaning == .expense ? .neutral : meaning, currency: currency))
                .font(.headline.monospacedDigit())
                .foregroundStyle(meaning == .expense ? PennyColor.label : meaning.color)
        }
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

/// Recent entries of the month, newest first, with "See all" opening Activity.
struct RecentSection: View {
    @Environment(ShellModel.self) private var shell
    let report: LedgerReport
    let summary: MonthSummary

    var body: some View {
        let entries = Array(report.monthEntries(summary).filter { !$0.scheduled }.prefix(5))
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Recent").font(.title3.weight(.bold))
                Spacer()
                Button("See all") { shell.route.select(.activity) }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PennyColor.tintText)
                    .frame(minHeight: Metrics.minTouchTarget)
            }
            if entries.isEmpty {
                Text("Nothing this month yet. New entries show up here.")
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .pennyCard()
            } else {
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        EntryRow(entry: entry, report: report, currency: report.ledger.currency.rawValue)
                        if entry.id != entries.last?.id { Divider().padding(.leading, 64) }
                    }
                }
                .background(
                    PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
            }
        }
        .accessibilityIdentifier("home.recent")
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
        }
        .accessibilityIdentifier("home.empty")
    }
}
