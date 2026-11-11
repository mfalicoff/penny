import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Text, colors and small pieces shared by Home, the money flow, Insights and the calendar
/// (MAZ-77). Sentences are built here, without a view, so tests read them directly.
enum OverviewText {
    static func money(_ cents: Int64, _ currency: String) -> String {
        MoneyFormat.amount(cents, currency: currency)
    }

    /// The Follow your money summary VoiceOver reads on Home's compact card.
    static func flowSummary(_ flow: MoneyFlow, currency: String) -> String {
        if flow.isEmpty { return "Nothing recorded this month yet." }
        var parts = [
            "Came in \(money(flow.income, currency))", "spent \(money(flow.expense, currency))",
            "invested \(money(flow.investment, currency))",
        ]
        if flow.gap > 0 {
            parts.append("\(money(flow.gap, currency)) more went out than came in")
        } else {
            parts.append("\(money(flow.remaining, currency)) left over")
        }
        return parts.joined(separator: ", ") + "."
    }

    /// What one row of the flow is, for its label and the focus card: "45% of income · 77% of
    /// spending", "Not spending · 6% of income" for contributions.
    static func flowShares(_ node: MoneyFlow.Node, in flow: MoneyFlow) -> String {
        var parts: [String] = []
        switch node.role {
        case .beyondIncome:
            if let share = Percent.text(node.amount, of: flow.outflow) { parts.append("\(share) of what went out") }
            parts.append("not covered by income")
        case .invested:
            if let share = flow.percentOfIncome(node) { parts.append("\(share) of income") }
            parts.append("a contribution, not spending")
        default:
            if let share = flow.percentOfIncome(node) { parts.append("\(share) of income") }
            if let share = flow.percentOfSpending(node) { parts.append("\(share) of spending") }
        }
        return parts.joined(separator: " · ")
    }

    /// One flow row for VoiceOver: "Home, $1,450.00, 45% of income · 77% of spending".
    static func flowNode(_ node: MoneyFlow.Node, in flow: MoneyFlow, currency: String) -> String {
        let shares = flowShares(node, in: flow)
        let direction = node.isSource ? "came in" : "went out"
        return [node.label, "\(money(node.amount, currency)) \(direction)", shares]
            .filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// Insights' sentence comparing this month's spending with last month's.
    static func comparison(_ comparison: MonthComparison, currency: String) -> String {
        guard let previous = comparison.previousMonth else { return "No earlier month to compare with." }
        let name = MonthPicker.title(previous, long: false)
        let difference = comparison.difference
        if comparison.current == 0 && comparison.previous == 0 { return "Nothing spent in either month." }
        if difference == 0 { return "The same as \(name)" }
        let amount = money(abs(difference), currency)
        return difference < 0 ? "\(amount) less than \(name)" : "\(amount) more than \(name)"
    }

    /// "Most went to Home and Groceries."
    static func topCategories(_ breakdown: CategoryBreakdown) -> String? {
        let names = breakdown.rows.prefix(2).map(\.category.name)
        switch names.count {
        case 0: return nil
        case 1: return "All of it went to \(names[0])."
        default: return "Most went to \(names[0]) and \(names[1])."
        }
    }

    /// One calendar day for VoiceOver: "Friday, November 6, spent $62.00, invested $200.00,
    /// 1 scheduled".
    static func calendarDay(_ day: CalendarMonth.Day, currency: String, today: CalendarDate) -> String {
        var parts = [DayText.date(day.date).formatted(.dateTime.weekday(.wide).month(.wide).day())]
        if day.date == today { parts.append("today") }
        if day.spent > 0 { parts.append("spent \(money(day.spent, currency))") }
        if day.income > 0 { parts.append("received \(money(day.income, currency))") }
        if day.invested > 0 { parts.append("invested \(money(day.invested, currency))") }
        if day.scheduledCount > 0 { parts.append("\(day.scheduledCount) scheduled, not recorded yet") }
        if day.isEmpty { parts.append("nothing recorded") }
        return parts.joined(separator: ", ")
    }

    /// Accessibility identifiers end in a model id; ids with characters outside the identifier
    /// convention (a flow node's `expense:food`) use `-` for them.
    static func identifier(_ id: String) -> String {
        String(
            id.map { character -> Character in
                character.isASCII && (character.isLetter || character.isNumber || character == "_" || character == "-")
                    ? character : "-"
            })
    }
}

/// Colors for the money flow's rows: categories keep their palette color, and meaning rows use
/// their meaning (income green, invested indigo, left over green), so color is never the only
/// cue: every row is also named in text.
enum FlowStyle {
    static func color(_ node: MoneyFlow.Node, index: Int = 0) -> Color {
        switch node.role {
        case .income: PennyColor.income.opacity(index == 0 ? 1 : max(0.45, 1 - Double(index) * 0.2))
        case .beyondIncome: PennyColor.secondaryLabel
        case .expense:
            PennyColor.category(
                CategoryStyle.color(forCategoryID: node.categoryIds.first ?? "", hex: node.colorHex ?? ""))
        case .more: PennyColor.tertiaryLabel
        case .invested: PennyColor.invest
        case .leftOver: PennyColor.income
        }
    }

    static func symbol(_ node: MoneyFlow.Node, report: LedgerReport) -> String {
        switch node.role {
        case .income, .expense:
            let category = report.categories.first { $0.id == node.categoryIds.first }
            return CategoryStyle.symbol(forIonicon: category?.icon ?? "pricetag")
        case .beyondIncome: return "arrow.down.right"
        case .more: return "ellipsis"
        case .invested: return "chart.line.uptrend.xyaxis"
        case .leftOver: return "leaf"
        }
    }
}

/// A section title on Home and the analysis pages, with an optional trailing control.
struct OverviewHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            trailing()
        }
    }
}

extension OverviewHeader where Trailing == EmptyView {
    init(_ title: String) {
        self.init(title: title) { EmptyView() }
    }
}

/// Says when shared expenses may be missing from the month's totals.
struct SharedProjectionNotice: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        if case .failed(let message) = shell.shared.status(for: shell.month) {
            StatusBanner(tone: .info, title: "Shared expenses may be missing", message: message)
                .accessibilityIdentifier("home.sharedNotice")
        }
    }
}

extension View {
    /// Pages of the Home stack keep the month picker in their toolbar, so the month can change
    /// without going back.
    func overviewToolbar() -> some View {
        toolbar {
            ToolbarItem(placement: .primaryAction) { MonthPicker() }
        }
    }
}
