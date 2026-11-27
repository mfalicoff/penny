import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The monthly recap (`iphone-recap`, `iphone-recap-empty` cards, MAZ-292): a past month's
/// recorded spending next to the month before and the same month last year, money in and out,
/// the categories that changed most, shared expenses and quiet days. Opened from Insights' Recap
/// button, the recap banner or its notification; it keeps its own month (any past month), chosen
/// in its toolbar. Every number comes from `LedgerReport.review` (the shared rule).
///
/// Motion (docs/design/motion.md §7): the first time the recap appears its totals count up from 0
/// and every bar grows from zero together (`emphasized`); changing the month counts and moves
/// them to the new values. Under Reduce Motion the final values show at once. VoiceOver reads the
/// final values only.
struct RecapView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var month: MonthKey
    /// False until the recap first appears, so its totals count up and its bars grow.
    @State private var appeared = false

    init(month: MonthKey) {
        _month = State(initialValue: month)
    }

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let review = report.review(month, today: shell.today)
            let currency = ledger.currency.rawValue
            let progress = appeared || reduceMotion ? 1.0 : 0
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(RecapText.subtitle).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    if review.isEmpty {
                        RecapEmptyCard(month: $month, months: months)
                            .padding(.top, 24)
                    } else {
                        RecapSpentCard(review: review, currency: currency, progress: progress)
                            .padding(.top, 16)
                        RecapMoneyCard(review: review, currency: currency, progress: progress)
                            .padding(.top, 10)
                        RecapChanges(review: review, currency: currency)
                        RecapShared(review: review, report: report, currency: currency)
                        RecapHighlights(review: review)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .background(PennyColor.background)
        .navigationTitle(RecapText.title(month))
        .toolbarTitleDisplayModeLarge()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                RecapMonthMenu(month: $month, months: months)
            }
        }
        .pennyHaptic(.stepPeriod, trigger: month)
        .task(id: month) { await shell.refreshRecap(month) }
        .onAppear {
            withAnimation(Motion.movement(.emphasized, reduceMotion: reduceMotion)) { appeared = true }
        }
        .accessibilityIdentifier("screen.recap")
    }

    /// The months the recap offers: the twelve before this one, and the one it opened on.
    private var months: [MonthKey] { Self.months(today: shell.today, including: month) }

    static func months(today: CalendarDate, including month: MonthKey) -> [MonthKey] {
        var months = (1...12).compactMap { MonthKey(today).shifted(by: -$0) }
        if !months.contains(month) { months.append(month) }
        return months.sorted(by: >)
    }
}

/// The recap's month in its toolbar: a menu of past months, as Home's month picker.
struct RecapMonthMenu: View {
    @Binding var month: MonthKey
    let months: [MonthKey]

    var body: some View {
        Menu {
            Picker("Month", selection: $month) {
                ForEach(months, id: \.self) { month in
                    Text(MonthPicker.title(month, long: true)).tag(month)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(MonthPicker.title(month, long: false))
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(PennyColor.label)
        }
        .tint(PennyColor.label)
        .accessibilityLabel("Month, \(MonthPicker.title(month, long: true))")
        .accessibilityIdentifier("recap.month")
    }
}

// MARK: - Spent

/// Spent, with the month, the month before and the same month last year as bars on one scale, and
/// the sentence comparing them.
struct RecapSpentCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The month names' column, as the card's 70-point labels, scaled with the text.
    @ScaledMetric(relativeTo: .footnote) private var labelWidth = 76.0
    /// The amounts' column, so every bar has the same track.
    @ScaledMetric(relativeTo: .footnote) private var amountWidth = 64.0
    let review: MonthReview
    let currency: String
    /// 0 before the recap first appears, then 1: the totals count up and the bars grow.
    let progress: Double

    var body: some View {
        let spent = Int64((Double(review.spent) * progress).rounded())
        let text = MoneyFormat.amount(spent, currency: currency)
        let parts = MoneyFormat.heroParts(text)
        VStack(alignment: .leading, spacing: 0) {
            Text("SPENT").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityHidden(true)
            let fraction = Text(parts.fraction).font(.title2.weight(.bold)).foregroundStyle(PennyColor.secondaryLabel)
            Text("\(Text(parts.whole))\(fraction)")
                .font(.largeTitle.weight(.bold))
                .kerning(-1)
                .foregroundStyle(PennyColor.label)
                .pennyCounting(Double(spent))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.top, 6)
                .accessibilityLabel("Spent, \(MoneyFormat.amount(review.spent, currency: currency))")
                .accessibilityIdentifier("recap.spent")
            bars.padding(.top, 14)
            if let sentence = RecapText.comparison(review) {
                let lead = Text(sentence.lead).fontWeight(.semibold).foregroundStyle(PennyColor.label)
                Text("\(lead)\(sentence.rest)")
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .accessibilityIdentifier("recap.comparison")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .pennyCard()
    }

    private var bars: some View {
        let scale = Double(max(review.spent, review.previous.spent ?? 0, review.lastYear.spent ?? 0, 1))
        return VStack(alignment: .leading, spacing: 8) {
            bar(
                RecapText.barTitle(review.month, lastYear: false), review.spent, scale: scale, current: true,
                id: "current")
            compared(review.previous, lastYear: false, scale: scale, id: "previous")
            compared(review.lastYear, lastYear: true, scale: scale, id: "lastYear")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .font(.footnote)
        // Every bar grows or moves together (`emphasized`), at once under Reduce Motion.
        .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: progress)
        .pennyChartMotion([review.spent, review.previous.spent ?? -1, review.lastYear.spent ?? -1])
    }

    @ViewBuilder
    private func compared(_ month: ComparedMonth, lastYear: Bool, scale: Double, id: String) -> some View {
        if let spent = month.spent {
            bar(RecapText.barTitle(month.month, lastYear: lastYear), spent, scale: scale, current: false, id: id)
        } else {
            // The owner's decision for a first month: a line in place of the bar.
            HStack(spacing: 10) {
                Text(RecapText.barTitle(month.month, lastYear: lastYear))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(minWidth: labelWidth, alignment: .leading)
                    .fixedSize()
                Text(RecapText.noComparison(month.month, lastYear: lastYear))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .opacity(progress)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(RecapText.noComparison(month.month, lastYear: lastYear))
            .accessibilityIdentifier("recap.bar.\(id)")
        }
    }

    private func bar(_ title: String, _ cents: Int64, scale: Double, current: Bool, id: String) -> some View {
        HStack(spacing: 10) {
            Text(title).foregroundStyle(PennyColor.secondaryLabel)
                .frame(minWidth: labelWidth, alignment: .leading)
                .fixedSize()
            GeometryReader { proxy in
                Capsule()
                    .fill(PennyColor.label.opacity(current ? 0.82 : 0.3))
                    .frame(width: cents > 0 ? max(4, proxy.size.width * Double(cents) / scale * progress) : 0)
                    .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 8)
            .accessibilityHidden(true)
            Text(MoneyFormat.whole(Int64((Double(cents) * progress).rounded()), currency: currency))
                .fontWeight(.semibold)
                .foregroundStyle(PennyColor.label)
                .pennyCounting(Double(cents) * progress)
                .frame(minWidth: amountWidth, alignment: .trailing)
                .fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(MoneyFormat.amount(cents, currency: currency)) spent")
        .accessibilityIdentifier("recap.bar.\(id)")
    }
}

// MARK: - Money in and out

/// Came in, and where it went: spent, invested and left over as one bar with a legend.
struct RecapMoneyCard: View {
    let review: MonthReview
    let currency: String
    let progress: Double

    var body: some View {
        let scaled = { (cents: Int64) in Int64((Double(cents) * progress).rounded()) }
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Came in").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                Spacer(minLength: 8)
                Text(MoneyFormat.amount(scaled(review.cameIn), currency: currency))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(PennyColor.label)
                    .pennyCounting(Double(scaled(review.cameIn)))
            }
            FlowBar(segments: [
                (scaled(review.spent), FlowSummaryCard.spentColor), (scaled(review.invested), PennyColor.invest),
                (scaled(max(0, review.leftOver)), PennyColor.income),
            ])
            .padding(.top, 10)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) { legend(scaled) }
                VStack(alignment: .leading, spacing: 6) { legend(scaled) }
            }
            .font(.footnote)
            .padding(.top, 12)
        }
        .pennyCard()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Money in and out")
        .accessibilityValue(Self.spoken(review, currency: currency))
        .accessibilityIdentifier("recap.money")
    }

    @ViewBuilder
    private func legend(_ scaled: (Int64) -> Int64) -> some View {
        HStack(spacing: 6) {
            Circle().fill(FlowSummaryCard.spentColor).frame(width: 8, height: 8)
            Text("Spent").foregroundStyle(PennyColor.secondaryLabel)
        }
        .fixedSize()
        LegendItem(
            title: "Invested", amount: MoneyFormat.whole(scaled(review.invested), currency: currency),
            dot: PennyColor.invest, value: scaled(review.invested))
        if review.leftOver < 0 {
            LegendItem(
                title: "Overspent", amount: MoneyFormat.whole(scaled(-review.leftOver), currency: currency),
                dot: PennyColor.danger, value: scaled(-review.leftOver))
        } else {
            HStack(spacing: 6) {
                Circle().fill(PennyColor.income).frame(width: 8, height: 8)
                Text("Left over").foregroundStyle(PennyColor.secondaryLabel)
                Text(MoneyFormat.whole(scaled(review.leftOver), currency: currency))
                    .fontWeight(.semibold).monospacedDigit().foregroundStyle(PennyColor.income)
                    .pennyCounting(Double(scaled(review.leftOver)))
            }
            .fixedSize()
        }
    }

    static func spoken(_ review: MonthReview, currency: String) -> String {
        var parts = [
            "Came in \(MoneyFormat.amount(review.cameIn, currency: currency))",
            "spent \(MoneyFormat.amount(review.spent, currency: currency))",
            "invested \(MoneyFormat.amount(review.invested, currency: currency))",
        ]
        if review.leftOver < 0 {
            parts.append("\(MoneyFormat.amount(-review.leftOver, currency: currency)) more went out than came in")
        } else {
            parts.append("\(MoneyFormat.amount(review.leftOver, currency: currency)) left over")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Rows

/// A section of the recap: its title, then rows on one solid card.
private struct RecapSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            OverviewHeader(title)
            VStack(spacing: 0) { content() }
                .background(
                    PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
        .padding(.top, 22)
    }
}

/// One row of a recap section: an icon, a title and a line under it, and an optional trailing part.
private struct RecapRow<Trailing: View>: View {
    let icon: CategoryIcon
    let title: String
    let detail: String?
    var divider = false
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                icon
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                    if let detail {
                        Text(detail).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                trailing()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: ControlSize.row)
            if divider { Divider().padding(.leading, 64) }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The categories that moved most against the month before, with "New" for one that had nothing.
struct RecapChanges: View {
    let review: MonthReview
    let currency: String

    var body: some View {
        if !review.biggestChanges.isEmpty {
            RecapSection(title: "Biggest changes") {
                ForEach(review.biggestChanges, id: \.key) { change in
                    RecapRow(
                        icon: CategoryIcon(
                            symbol: CategoryStyle.symbol(forIonicon: change.icon),
                            color: PennyColor.category(
                                CategoryStyle.color(forCategoryID: change.categoryId, hex: change.color))),
                        title: change.name,
                        detail: RecapText.previously(change, month: review.previous.month, currency: currency),
                        divider: change.key != review.biggestChanges.last?.key
                    ) {
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(MoneyFormat.amount(change.current, currency: currency))
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(PennyColor.label)
                                .fixedSize()
                            Chip(text: RecapText.chip(change), isNew: change.percent == nil)
                        }
                    }
                    .accessibilityIdentifier("recap.change.\(OverviewText.identifier(change.categoryId))")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("recap.changes")
        }
    }

    /// "+18%" on the fill, or "New" in copper on its soft tint (a fade under Reduce Motion, with the bars).
    private struct Chip: View {
        let text: String
        let isNew: Bool

        var body: some View {
            Text(text)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(isNew ? PennyColor.tintText : PennyColor.label)
                .padding(.horizontal, 7)
                .frame(minHeight: 20)
                .background(isNew ? PaletteToken.tintSoft.value.color : PennyColor.fill, in: Capsule())
                .fixedSize()
        }
    }
}

/// Your top shared expense with who paid, and what others paid of your split expenses.
struct RecapShared: View {
    let review: MonthReview
    let report: LedgerReport
    let currency: String

    var body: some View {
        let top = review.shared.top
        let split = review.split.othersPaid > 0 ? review.split : nil
        if top != nil || split != nil {
            RecapSection(title: "Shared") {
                if let top {
                    let category = report.categories.first { $0.id == top.categoryId }
                    RecapRow(
                        icon: category.map {
                            CategoryIcon(
                                symbol: CategoryStyle.symbol(forIonicon: $0.icon),
                                color: PennyColor.category(CategoryStyle.color(forCategoryID: $0.id, hex: $0.color)))
                        } ?? .neutral(symbol: "person.2"),
                        title: top.title, detail: RecapText.topShared(top), divider: split != nil
                    ) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(MoneyFormat.amount(top.share, currency: currency))
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(PennyColor.label)
                            Text("of \(MoneyFormat.amount(top.total, currency: currency))")
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(PennyColor.secondaryLabel)
                        }
                        .fixedSize()
                    }
                    .accessibilityIdentifier("recap.topShared")
                }
                if let split {
                    let text = RecapText.split(split, currency: currency)
                    RecapRow(icon: .neutral(symbol: "person.2"), title: text.title, detail: text.detail) {
                        EmptyView()
                    }
                    .accessibilityIdentifier("recap.split")
                }
            }
        }
    }
}

/// Days without spending and the longest run of them.
struct RecapHighlights: View {
    let review: MonthReview

    var body: some View {
        let quiet = RecapText.quietDays(review)
        RecapSection(title: "Highlights") {
            RecapRow(icon: .neutral(symbol: "calendar"), title: quiet.title, detail: quiet.detail) { EmptyView() }
                .accessibilityIdentifier("recap.highlights")
        }
    }
}

// MARK: - Empty

/// "Nothing to recap yet" (`iphone-recap-empty`): a month with no recorded entries (only scheduled
/// ones count as none), with Add an entry and Choose another month.
struct RecapEmptyCard: View {
    @Environment(ShellModel.self) private var shell
    @Binding var month: MonthKey
    let months: [MonthKey]

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "sparkles")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 64, height: 64)
                .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityHidden(true)
            Text("Nothing to recap yet")
                .font(.title2.weight(.bold))
                .foregroundStyle(PennyColor.label)
                .padding(.top, 18)
                .accessibilityAddTraits(.isHeader)
            Text(RecapText.emptyMessage(month))
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            Button {
                shell.navigate { $0.openAddEntry() }
            } label: {
                Label("Add an entry", systemImage: "plus")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 20)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .background(PennyColor.tint, in: Capsule())
            }
            .buttonStyle(.pennyPress)
            .padding(.top, 22)
            .accessibilityIdentifier("recap.addEntry")
            Menu {
                Picker("Month", selection: $month) {
                    ForEach(months, id: \.self) { month in
                        Text(MonthPicker.title(month, long: true)).tag(month)
                    }
                }
            } label: {
                Text("Choose another month")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(PennyColor.tintText)
                    .frame(minHeight: Metrics.minTouchTarget)
            }
            .padding(.top, 4)
            .accessibilityIdentifier("recap.chooseMonth")
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(EdgeInsets(top: 34, leading: 26, bottom: 16, trailing: 26))
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("recap.empty")
    }
}
