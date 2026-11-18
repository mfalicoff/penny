import Foundation
import PennyDesign
import PennyDomain
import SwiftUI
import WidgetKit

/// Widget styling: the redesign's tokens adapted to WidgetKit (docs/ios/widgets.md#design).
/// Home Screen widgets sit on the solid surface (no glass), with SF text styles and the
/// meaning colors; copper is the only tint.
enum PennyWidgetStyle {
    /// Monthly balance: small, Month at a glance (medium) and the two Lock Screen accessories
    /// (MAZ-135). They share the frozen `BalanceChartWidget` kind, so a placed widget keeps working.
    /// The accessories exist on iOS only; the macOS host tests see small and medium.
    #if os(iOS)
        static let balanceFamilies: [WidgetFamily] = [
            .systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular,
        ]
    #else
        static let balanceFamilies: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif
    /// Recent expenses: small only.
    static let recentFamilies: [WidgetFamily] = [.systemSmall]
    @MainActor static var background: Color { PennyColor.surface }
}

/// The leaf mark and a caption, the header of both widgets.
struct WidgetHeader: View {
    let title: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 16, height: 16)
                .background(PennyColor.tint, in: .rect(cornerRadius: 5))
                .widgetAccentable()
                .accessibilityHidden(true)
            Text(title)
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(PennyColor.secondaryLabel)
                .lineLimit(1)
        }
    }
}

/// Signed out, or a snapshot this extension can't read: never a number.
struct WidgetMessage: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetHeader(title: title)
            Spacer(minLength: 0)
            Text(message)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    static func signedOut(_ title: String) -> WidgetMessage { .init(title: title, message: "Sign in to Penny") }
    static func openApp(_ title: String) -> WidgetMessage { .init(title: title, message: "Open Penny to update") }
}

/// A line under the numbers saying how current they are, if they are not.
struct FreshnessNote: View {
    let snapshot: WidgetSnapshot
    let freshness: WidgetContent.Freshness

    var body: some View {
        Group {
            switch freshness {
            case .pastMonth: Text("Open Penny to update")
            case .old(let since): Text("Updated \(since, style: .relative) ago")
            case .current: if snapshot.waitingToSync { Text("As of last sync") }
            }
        }
        .font(.caption2)
        .foregroundStyle(PennyColor.secondaryLabel)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

/// Monthly balance, small (`system-widgets`, "Monthly balance · small").
struct BalanceWidgetView: View {
    let content: WidgetContent

    var body: some View {
        switch content {
        case .signedOut: WidgetMessage.signedOut("Left to spend")
        case .openApp: WidgetMessage.openApp("Left to spend")
        case .ready(let snapshot, let freshness): ready(snapshot, freshness)
        }
    }

    private func ready(_ snapshot: WidgetSnapshot, _ freshness: WidgetContent.Freshness) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "Left to spend")
            Spacer(minLength: 0)
            WidgetAmount(cents: snapshot.leftToSpend, currency: snapshot.currency)
            Text(BalanceText.monthName(snapshot.month))
                .font(.caption)
                .foregroundStyle(PennyColor.secondaryLabel)
                .lineLimit(1)
            if let projected = BalanceText.projected(snapshot) {
                Text(projected)
                    .font(.caption)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .privacySensitive()
            }
            Spacer(minLength: 0)
            if snapshot.isEmptyMonth {
                Text("Nothing recorded yet")
                    .font(.caption2)
                    .foregroundStyle(PennyColor.secondaryLabel)
            } else {
                FlowBar(bar: WidgetFlowBar(snapshot))
            }
            FreshnessNote(snapshot: snapshot, freshness: freshness)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(BalanceText.spoken(snapshot, freshness: freshness))
    }
}

/// The hero amount, cents drawn smaller (design-kit `.amt small`). Long amounts shrink to fit.
struct WidgetAmount: View {
    let cents: Int64
    let currency: String

    var body: some View {
        let parts = MoneyFormat.heroParts(MoneyFormat.signed(cents, meaning: .neutral, currency: currency))
        let whole = Text(parts.whole)
        let fraction = Text(parts.fraction).font(.title3.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
        Text("\(whole)\(fraction)")
            .font(.title.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(PennyColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .widgetAccentable()
            .privacySensitive()
    }
}

/// Recorded spending, contributions and what is left, as one 8 pt bar.
struct FlowBar: View {
    let bar: WidgetFlowBar

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 2) {
                segment(bar.spent, PennyColor.label, width: proxy.size.width)
                segment(bar.invested, PennyColor.invest, width: proxy.size.width)
                segment(bar.left, PennyColor.income, width: proxy.size.width)
            }
            .frame(width: proxy.size.width, alignment: .leading)
        }
        .frame(height: 8)
        .background(PennyColor.fill, in: .capsule)
        .clipShape(.capsule)
        .privacySensitive()
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func segment(_ fraction: Double, _ color: Color, width: Double) -> some View {
        if fraction > 0 {
            color.frame(width: max(2, width * fraction))
        }
    }
}

/// The strings of the Monthly balance widget, pure so tests read them.
enum BalanceText {
    static func monthName(_ month: String, locale: Locale = .current) -> String {
        guard let key = MonthKey(month),
            let date = Calendar(identifier: .gregorian).date(
                from: DateComponents(year: key.year, month: key.month, day: 1))
        else { return month }
        return date.formatted(.dateTime.month(.wide).locale(locale))
    }

    /// "$966.65 projected": Projected as its own line, never mixed into Left to spend. Nil when
    /// it equals Left to spend (nothing scheduled or expected).
    static func projected(_ snapshot: WidgetSnapshot, locale: Locale = .current) -> String? {
        guard snapshot.projectedRemaining != snapshot.leftToSpend else { return nil }
        let amount = MoneyFormat.signed(
            snapshot.projectedRemaining, meaning: .neutral, currency: snapshot.currency, locale: locale)
        return "\(amount) projected"
    }

    static func spoken(
        _ snapshot: WidgetSnapshot, freshness: WidgetContent.Freshness, locale: Locale = .current
    ) -> String {
        let month = monthName(snapshot.month, locale: locale)
        var text =
            "Left to spend in \(month), "
            + MoneyFormat.spoken(snapshot.leftToSpend, meaning: .neutral, currency: snapshot.currency, locale: locale)
        if snapshot.projectedRemaining != snapshot.leftToSpend {
            text +=
                ". Projected, "
                + MoneyFormat.spoken(
                    snapshot.projectedRemaining, meaning: .neutral, currency: snapshot.currency, locale: locale)
        }
        if snapshot.isEmptyMonth { text += ". Nothing recorded yet" }
        switch freshness {
        case .pastMonth: text += ". Open Penny to update"
        case .old: text += ". Not updated recently"
        case .current: if snapshot.waitingToSync { text += ". As of last sync" }
        }
        return text
    }
}

/// Recent expenses, small (`system-widgets`, "Recent expenses · small"), with the + shortcut.
struct RecentExpensesWidgetView: View {
    let content: WidgetContent

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                switch content {
                case .signedOut: WidgetMessage.signedOut("Recent")
                case .openApp: WidgetMessage.openApp("Recent")
                case .ready(let snapshot, let freshness): ready(snapshot, freshness)
                }
            }
            // Signed out, the tap opens sign-in, so the + would promise something it can't do.
            if case .ready = content { AddButton() }
        }
    }

    private func ready(_ snapshot: WidgetSnapshot, _ freshness: WidgetContent.Freshness) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Recent")
            if snapshot.recentExpenses.isEmpty {
                Text("No expenses yet")
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(snapshot.recentExpenses.enumerated()), id: \.offset) { _, expense in
                        ExpenseRow(expense: expense, currency: snapshot.currency)
                    }
                }
            }
            Spacer(minLength: 0)
            FreshnessNote(snapshot: snapshot, freshness: freshness)
                .padding(.trailing, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

struct ExpenseRow: View {
    let expense: WidgetSnapshot.Expense
    let currency: String

    var body: some View {
        HStack(spacing: 4) {
            if expense.shared {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityLabel("Shared")
            }
            Text(expense.title)
                .font(.footnote)
                .foregroundStyle(PennyColor.label)
                .lineLimit(1)
                .frame(minWidth: 36, alignment: .leading)
            Spacer(minLength: 4)
            Text(MoneyFormat.signed(expense.cents, meaning: .expense, currency: currency))
                .font(.footnote.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(MoneyMeaning.expense.color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .layoutPriority(1)
                .accessibilityLabel(MoneyFormat.spoken(expense.cents, meaning: .expense, currency: currency))
        }
        .privacySensitive()
    }
}

/// The copper + of the design. A small widget has one tap target, so this is a picture of the
/// widget's action (the whole widget opens the add entry sheet), not a separate button.
struct AddButton: View {
    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(PennyColor.tint, in: .circle)
            .widgetAccentable()
            .accessibilityLabel("Add an expense")
    }
}

/// Monthly balance in whichever family the person placed: small, Month at a glance (medium)
/// or a Lock Screen accessory.
struct BalanceFamilyView: View {
    let content: WidgetContent
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemMedium: MonthGlanceWidgetView(content: content)
        #if os(iOS)
            case .accessoryRectangular: LockRectangularView(content: content)
            case .accessoryCircular: LockCircularView(content: content)
        #endif
        default: BalanceWidgetView(content: content)
        }
    }
}

/// Month at a glance, medium (`system-widgets`, "Month at a glance · medium"): Left to spend
/// beside the spent / invested / left bar and its legend, with the + shortcut. A medium widget
/// has several tap targets: the + opens the add entry sheet, the rest opens Home.
struct MonthGlanceWidgetView: View {
    let content: WidgetContent

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                switch content {
                case .signedOut: WidgetMessage.signedOut("Left to spend")
                case .openApp: WidgetMessage.openApp("Left to spend")
                case .ready(let snapshot, let freshness): ready(snapshot, freshness)
                }
            }
            if case .ready = content {
                Link(destination: WidgetLink.addEntry) { AddButton() }
            }
        }
    }

    private func ready(_ snapshot: WidgetSnapshot, _ freshness: WidgetContent.Freshness) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: BalanceText.monthName(snapshot.month))
            Spacer(minLength: 0)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    WidgetAmount(cents: snapshot.leftToSpend, currency: snapshot.currency)
                    Text("Left to spend")
                        .font(.caption)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .lineLimit(1)
                    if let projected = BalanceText.projected(snapshot) {
                        Text(projected)
                            .font(.caption)
                            .foregroundStyle(PennyColor.secondaryLabel)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .privacySensitive()
                    }
                }
                .layoutPriority(1)
                VStack(alignment: .leading, spacing: 8) {
                    if snapshot.isEmptyMonth {
                        Text("Nothing recorded yet")
                            .font(.caption)
                            .foregroundStyle(PennyColor.secondaryLabel)
                    } else {
                        FlowBar(bar: WidgetFlowBar(snapshot))
                        FlowLegend()
                    }
                }
                .padding(.top, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer(minLength: 0)
            FreshnessNote(snapshot: snapshot, freshness: freshness)
                .padding(.trailing, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(BalanceText.spoken(snapshot, freshness: freshness))
    }
}

/// The legend under the medium bar: Spent, Invested, Left in the bar's colors.
struct FlowLegend: View {
    var body: some View {
        // The amount beside it takes the room it needs; the legend steps down rather than
        // truncating a label.
        ViewThatFits(in: .horizontal) {
            items(spacing: 9).font(.caption)
            items(spacing: 6).font(.caption2)
            VStack(alignment: .leading, spacing: 2) { items(spacing: 0, stacked: true) }.font(.caption2)
        }
        .foregroundStyle(PennyColor.secondaryLabel)
        .lineLimit(1)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func items(spacing: CGFloat, stacked: Bool = false) -> some View {
        if stacked {
            item("Spent", PennyColor.label)
            item("Invested", PennyColor.invest)
            item("Left", PennyColor.income)
        } else {
            HStack(spacing: spacing) {
                item("Spent", PennyColor.label)
                item("Invested", PennyColor.invest)
                item("Left", PennyColor.income)
            }
        }
    }

    private func item(_ title: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title)
        }
    }
}

/// Lock Screen, rectangular: the leaf, **Left to spend** and the whole amount. Monochrome: iOS
/// tints it, so it uses only the primary style and no meaning colors.
struct LockRectangularView: View {
    let content: WidgetContent

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label("Left to spend", systemImage: "leaf.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .widgetAccentable()
                .lineLimit(1)
            switch content {
            case .signedOut: message("Sign in to Penny")
            case .openApp: message("Open Penny to update")
            case .ready(let snapshot, let freshness):
                Text(LockText.whole(snapshot))
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .privacySensitive()
                if case .pastMonth = freshness {
                    Text(BalanceText.monthName(snapshot.month))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LockText.spoken(content))
    }

    private func message(_ text: String) -> some View {
        Text(text).font(.headline).lineLimit(2).minimumScaleFactor(0.7)
    }
}

/// Lock Screen, circular: a ring of the share of recorded income still left to spend, and that
/// share in the middle. Without recorded income (or a snapshot) the ring is empty.
struct LockCircularView: View {
    let content: WidgetContent

    var body: some View {
        let share: WidgetLeftShare? =
            if case .ready(let snapshot, _) = content { WidgetLeftShare(snapshot) } else { nil }
        Gauge(value: share?.fraction ?? 0) {
            Image(systemName: "leaf.fill")
        } currentValueLabel: {
            Text(share.map { "\($0.percent)%" } ?? "–")
                .monospacedDigit()
                .privacySensitive()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LockText.spokenShare(content))
    }
}

/// The strings of the Lock Screen accessories, pure so tests read them.
enum LockText {
    /// Left to spend without cents ("$1,116"): the rectangular accessory has room for one line.
    static func whole(_ snapshot: WidgetSnapshot, locale: Locale = .current) -> String {
        // Formatted without fraction digits rather than cut from the full amount, so locales
        // that put the symbol after the amount ("1 116 $" in fr_CA) keep it. The cents are dropped
        // (toward zero), as on the hero amount.
        let whole = (Decimal(snapshot.leftToSpend.magnitude) / 100).formatted(
            .currency(code: snapshot.currency).locale(locale).precision(.fractionLength(0)).rounded(rule: .down))
        return snapshot.leftToSpend < 0 ? MoneyFormat.minus + whole : whole
    }

    static func spoken(_ content: WidgetContent, locale: Locale = .current) -> String {
        switch content {
        case .signedOut: "Sign in to Penny"
        case .openApp: "Open Penny to update"
        case .ready(let snapshot, let freshness): BalanceText.spoken(snapshot, freshness: freshness, locale: locale)
        }
    }

    static func spokenShare(_ content: WidgetContent, locale: Locale = .current) -> String {
        switch content {
        case .signedOut: return "Sign in to Penny"
        case .openApp: return "Open Penny to update"
        case .ready(let snapshot, let freshness):
            var text: String
            if let share = WidgetLeftShare(snapshot) {
                text =
                    "\(share.percent) percent of income left to spend in \(BalanceText.monthName(snapshot.month, locale: locale))"
            } else {
                text = "No income recorded in \(BalanceText.monthName(snapshot.month, locale: locale))"
            }
            if case .pastMonth = freshness { text += ". Open Penny to update" }
            return text
        }
    }
}

#if DEBUG
    #Preview("Balance", as: .systemSmall) {
        BalanceWidget()
    } timeline: {
        PennyWidgetEntry(date: .now, content: .sample)
        PennyWidgetEntry(date: .now, content: .signedOut)
        PennyWidgetEntry(date: .now, content: .openApp)
    }

    #Preview("Recent", as: .systemSmall) {
        RecentExpensesWidget()
    } timeline: {
        PennyWidgetEntry(date: .now, content: .sample)
        PennyWidgetEntry(date: .now, content: .signedOut)
    }

    #Preview("Month at a glance", as: .systemMedium) {
        BalanceWidget()
    } timeline: {
        PennyWidgetEntry(date: .now, content: .sample)
        PennyWidgetEntry(date: .now, content: .signedOut)
        PennyWidgetEntry(date: .now, content: .openApp)
    }

    #if os(iOS)
        #Preview("Lock Screen rectangular", as: .accessoryRectangular) {
            BalanceWidget()
        } timeline: {
            PennyWidgetEntry(date: .now, content: .sample)
            PennyWidgetEntry(date: .now, content: .signedOut)
        }

        #Preview("Lock Screen circular", as: .accessoryCircular) {
            BalanceWidget()
        } timeline: {
            PennyWidgetEntry(date: .now, content: .sample)
            PennyWidgetEntry(date: .now, content: .signedOut)
        }
    #endif
#endif
