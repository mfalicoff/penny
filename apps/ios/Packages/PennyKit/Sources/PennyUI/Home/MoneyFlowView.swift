import Accessibility
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The money flow page (`money-flow` card): came in, went out and left over, the Sankey, the
/// focus card for the selected row, and every value as a list (the chart's accessible
/// alternative, always on screen). At accessibility text sizes the chart gives way to the list.
struct MoneyFlowView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var focused: String?

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let summary = report.month(shell.month)
            let flow = MoneyFlow(summary, categories: report.categories)
            let currency = ledger.currency.rawValue
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("From coming in to going out")
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    FlowTotals(flow: flow, currency: currency)
                    if flow.isEmpty {
                        PennyStateView(
                            .empty, title: "Nothing recorded in \(MonthPicker.title(shell.month, long: false))",
                            message: "Add income or an expense to see where your money goes.")
                    } else {
                        if !typeSize.isAccessibilitySize {
                            SankeyChart(flow: flow, currency: currency, focused: $focused)
                                .pennyCard(padding: 14)
                        }
                        if let id = focused, let node = flow.node(id: id) {
                            FlowFocusCard(node: node, flow: flow, report: report, currency: currency) {
                                focused = nil
                            }
                        }
                        FlowDetailsList(flow: flow, summary: summary, currency: currency, focused: $focused)
                    }
                    Text(
                        "Recorded entries only, your share of shared expenses. Scheduled and expected amounts are not included until they're recorded."
                    )
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: shell.month) { focused = nil }
        }
        .background(PennyColor.background)
        .navigationTitle("Money flow")
        .toolbarTitleDisplayModeLarge()
        .overviewToolbar()
        .accessibilityIdentifier("screen.moneyFlow")
    }
}

/// Came in, went out, and left over (or how much more went out than came in).
struct FlowTotals: View {
    let flow: MoneyFlow
    let currency: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) { stats }
            VStack(alignment: .leading, spacing: 10) { stats }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("moneyFlow.totals")
    }

    @ViewBuilder
    private var stats: some View {
        stat("Came in", flow.income)
        stat("Went out", flow.outflow)
        if flow.gap > 0 {
            stat("Beyond income", flow.gap)
        } else {
            stat("Left over", flow.remaining)
        }
    }

    private func stat(_ title: String, _ cents: Int64) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
            Text(MoneyFormat.amount(cents, currency: currency))
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: true, vertical: false)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The Sankey: income on the left, the month's total as a bar in the middle, where it went on
/// the right. Tapping a band or a label focuses that row and dims the others; tapping it again
/// clears the focus. The drawing is hidden from VoiceOver: each row is a button with its
/// amount and shares, and the chart also offers an Audio Graph (`accessibilityChartDescriptor`).
struct SankeyChart: View {
    let flow: MoneyFlow
    let currency: String
    @Binding var focused: String?
    @ScaledMetric(relativeTo: .footnote) private var slot = 40.0
    @ScaledMetric(relativeTo: .footnote) private var band = 200.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let nodeWidth = 6.0
    private let barWidth = 8.0
    private let gap = 8.0

    var body: some View {
        let layout = MoneyFlowLayout(flow, band: band, slot: slot, gap: gap)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("INCOME")
                Spacer()
                Text("WHERE IT GOES")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityHidden(true)
            GeometryReader { proxy in
                let geometry = Geometry(width: proxy.size.width, nodeWidth: nodeWidth, barWidth: barWidth)
                ZStack(alignment: .topLeading) {
                    bands(layout, geometry)
                        .contentShape(Rectangle())
                        .gesture(
                            SpatialTapGesture().onEnded { tap in
                                let source = tap.location.x < geometry.middleX
                                if let row = layout.row(at: tap.location.y, source: source) { toggle(row.id) }
                            }
                        )
                        .accessibilityHidden(true)
                    ForEach(Array(flow.sources.enumerated()), id: \.element.id) { index, node in
                        if let row = layout.sources.first(where: { $0.id == node.id }) {
                            label(node, index: index)
                                .frame(width: geometry.labelWidth - 8, alignment: .trailing)
                                .position(x: (geometry.labelWidth - 8) / 2, y: row.labelY)
                        }
                    }
                    ForEach(flow.destinations) { node in
                        if let row = layout.destinations.first(where: { $0.id == node.id }) {
                            label(node, index: 0)
                                .frame(width: geometry.labelWidth - 8, alignment: .leading)
                                .position(
                                    x: geometry.rightX + nodeWidth + 8 + (geometry.labelWidth - 8) / 2, y: row.labelY)
                        }
                    }
                }
            }
            .frame(height: layout.height)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Money flow chart")
        .accessibilityChartDescriptor(FlowChartDescriptor(flow: flow, currency: currency))
        .accessibilityIdentifier("moneyFlow.chart")
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: focused)
    }

    struct Geometry {
        let width: Double
        let nodeWidth: Double
        let barWidth: Double
        /// Room for each column's labels: about a third of the width, enough for "Food & drinks".
        var labelWidth: Double { min(150, max(84, width * 0.3)) }
        var leftX: Double { labelWidth }
        var rightX: Double { width - labelWidth - nodeWidth }
        var middleX: Double { (leftX + nodeWidth + rightX) / 2 - barWidth / 2 }
    }

    private func toggle(_ id: String) {
        focused = focused == id ? nil : id
    }

    private func opacity(_ id: String) -> Double {
        guard let focused else { return 0.3 }
        return focused == id ? 0.6 : 0.1
    }

    private func bands(_ layout: MoneyFlowLayout, _ geometry: Geometry) -> some View {
        Canvas { context, _ in
            let middle = geometry.middleX
            for (index, node) in flow.sources.enumerated() {
                guard let row = layout.sources.first(where: { $0.id == node.id }) else { continue }
                let color = FlowStyle.color(node, index: index)
                context.fill(
                    curve(
                        from: geometry.leftX + nodeWidth, y0: row.y, to: middle, y1: row.middleY,
                        thickness: row.thickness), with: .color(color.opacity(opacity(node.id))))
                context.fill(
                    Path(
                        roundedRect: CGRect(
                            x: geometry.leftX, y: row.y, width: nodeWidth, height: max(row.thickness, 3)),
                        cornerRadius: 3), with: .color(color))
            }
            for node in flow.destinations {
                guard let row = layout.destinations.first(where: { $0.id == node.id }) else { continue }
                let color = FlowStyle.color(node)
                context.fill(
                    curve(
                        from: middle + barWidth, y0: row.middleY, to: geometry.rightX, y1: row.y,
                        thickness: row.thickness), with: .color(color.opacity(opacity(node.id))))
                context.fill(
                    Path(
                        roundedRect: CGRect(
                            x: geometry.rightX, y: row.y, width: nodeWidth, height: max(row.thickness, 3)),
                        cornerRadius: 3), with: .color(color))
            }
            context.fill(
                Path(
                    roundedRect: CGRect(x: middle, y: layout.middleTop, width: barWidth, height: layout.band),
                    cornerRadius: barWidth / 2), with: .color(PennyColor.label))
        }
    }

    private func curve(from x0: Double, y0: Double, to x1: Double, y1: Double, thickness: Double) -> Path {
        let control = (x1 - x0) * 0.5
        var path = Path()
        path.move(to: CGPoint(x: x0, y: y0))
        path.addCurve(
            to: CGPoint(x: x1, y: y1), control1: CGPoint(x: x0 + control, y: y0),
            control2: CGPoint(x: x1 - control, y: y1))
        path.addLine(to: CGPoint(x: x1, y: y1 + thickness))
        path.addCurve(
            to: CGPoint(x: x0, y: y0 + thickness), control1: CGPoint(x: x1 - control, y: y1 + thickness),
            control2: CGPoint(x: x0 + control, y: y0 + thickness))
        path.closeSubpath()
        return path
    }

    private func label(_ node: MoneyFlow.Node, index: Int) -> some View {
        let dimmed = focused != nil && focused != node.id
        return Button {
            toggle(node.id)
        } label: {
            VStack(alignment: node.isSource ? .trailing : .leading, spacing: 0) {
                Text(node.label)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.label)
                    .multilineTextAlignment(node.isSource ? .trailing : .leading)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Text(MoneyFormat.amount(node.amount, currency: currency))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(FlowStyle.color(node, index: index))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .opacity(dimmed ? 0.45 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OverviewText.flowNode(node, in: flow, currency: currency))
        .accessibilityAddTraits(focused == node.id ? .isSelected : [])
        .accessibilityHint(focused == node.id ? "Clears the focus" : "Focuses this flow")
        .accessibilityIdentifier("moneyFlow.node.\(OverviewText.identifier(node.id))")
    }
}

/// The selected row: its amount and its share of income and of spending.
struct FlowFocusCard: View {
    let node: MoneyFlow.Node
    let flow: MoneyFlow
    let report: LedgerReport
    let currency: String
    let close: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: FlowStyle.symbol(node, report: report), color: FlowStyle.color(node), size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(node.label) · \(MoneyFormat.amount(node.amount, currency: currency))")
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                let shares = OverviewText.flowShares(node, in: flow)
                if !shares.isEmpty {
                    Text(shares).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                    .background(PennyColor.fill, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Clear focus")
            .accessibilityIdentifier("moneyFlow.focusClear")
        }
        .pennyCard(padding: 14)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("moneyFlow.focus")
    }
}

/// Every value of the flow as a list: came in and went out, with each row's shares, and the
/// categories inside "N more". The chart's accessible alternative, and the whole view at
/// accessibility text sizes.
struct FlowDetailsList: View {
    let flow: MoneyFlow
    let summary: MonthSummary
    let currency: String
    @Binding var focused: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OverviewHeader("Came in")
            rows(flow.sources)
            OverviewHeader("Went out")
            rows(flow.destinations)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("moneyFlow.details")
    }

    private func rows(_ nodes: [MoneyFlow.Node]) -> some View {
        VStack(spacing: 0) {
            if nodes.isEmpty {
                Text("Nothing recorded.").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
            ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
                row(node, index: index)
                if case .more = node.role {
                    ForEach(folded(node), id: \.category.id) { item in
                        HStack {
                            Text(item.category.name).font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            Text(MoneyFormat.amount(item.amount, currency: currency))
                                .font(.subheadline.monospacedDigit())
                        }
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .padding(.leading, 48).padding(.trailing, 16).padding(.vertical, 6)
                        .accessibilityElement(children: .combine)
                    }
                }
                if node.id != nodes.last?.id { Divider().padding(.leading, 16) }
            }
        }
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }

    private func folded(_ node: MoneyFlow.Node) -> [CategoryAmount] {
        let ids = Set(node.categoryIds)
        return summary.spending.filter { ids.contains($0.category.id) }
    }

    private func row(_ node: MoneyFlow.Node, index: Int) -> some View {
        Button {
            focused = focused == node.id ? nil : node.id
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Circle().fill(FlowStyle.color(node, index: index)).frame(width: 10, height: 10)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.label).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                    let shares = OverviewText.flowShares(node, in: flow)
                    if !shares.isEmpty {
                        Text(shares).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Text(MoneyFormat.amount(node.amount, currency: currency))
                    .font(.body.weight(.semibold).monospacedDigit())
                    .foregroundStyle(PennyColor.label)
                    .fixedSize()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(OverviewText.flowNode(node, in: flow, currency: currency))
        .accessibilityAddTraits(focused == node.id ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("moneyFlow.row.\(OverviewText.identifier(node.id))")
    }
}

/// The money flow as an Audio Graph: one bar per row, sources then destinations.
struct FlowChartDescriptor: AXChartDescriptorRepresentable {
    let flow: MoneyFlow
    let currency: String

    func makeChartDescriptor() -> AXChartDescriptor {
        let nodes = flow.nodes
        let xAxis = AXCategoricalDataAxisDescriptor(title: "Flow", categoryOrder: nodes.map(\.label))
        let maximum = Double(nodes.map(\.amount).max() ?? 0) / 100
        let yAxis = AXNumericDataAxisDescriptor(
            title: "Amount (\(currency))", range: 0...max(maximum, 1), gridlinePositions: []
        ) { value in
            MoneyFormat.amount(Int64((value * 100).rounded()), currency: currency)
        }
        let series = AXDataSeriesDescriptor(
            name: "Money flow", isContinuous: false,
            dataPoints: nodes.map { AXDataPoint(x: $0.label, y: Double($0.amount) / 100) })
        return AXChartDescriptor(
            title: "Money flow", summary: OverviewText.flowSummary(flow, currency: currency), xAxis: xAxis,
            yAxis: yAxis, additionalAxes: [], series: [series])
    }
}
