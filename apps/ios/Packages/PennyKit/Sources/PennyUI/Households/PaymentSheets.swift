import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Recording a payment that already happened outside Penny (`iphone-record-payment`, the
/// redesign's `record-share` and `record-monthly`), and the stale state (`iphone-payment-stale`).
///
/// Penny never moves money: these screens say so, and recording changes balances only, never
/// anyone's spending. A share payment settles one member's whole share of one expense; a monthly
/// payment records a full suggested transfer, from the month's last day (UTC). If the expense
/// or the suggestion changed after it was read, nothing is recorded: the sheet shows the old and
/// new amounts and offers only Review (no "record anyway").
struct PaymentSheet: View {
    let request: PaymentRequest
    @Bindable var model: HouseholdModel
    /// The current instant (`ShellModel.now`): the month's payment window and "2 min ago".
    var now: () -> Date = { Date() }
    @Environment(\.dismiss) private var dismiss

    @State private var working = false
    @State private var failure: HouseholdFailure?
    @State private var staleExpense: (old: WireSharedExpense, latest: WireSharedExpense?)?
    @State private var staleSuggestions: [WireTransfer]?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let staleExpense {
                        StaleExpenseView(
                            old: staleExpense.old, latest: staleExpense.latest, from: transfer.from,
                            people: model.people, currency: model.currency, now: now()
                        ) { dismiss() }
                    } else if let staleSuggestions {
                        StaleMonthlyView(
                            suggestions: staleSuggestions, people: model.people, currency: model.currency
                        ) { dismiss() }
                    } else {
                        details
                    }
                }
                .padding(Metrics.gutter)
            }
            // `iphone-record-payment` is drawn on the sheet's surface; the stale states keep their
            // solid groups on the grouped background, as on `iphone-payment-stale`.
            .background(isStale ? PennyColor.background : PennyColor.surface)
            .safeAreaInset(edge: .bottom) {
                if !isStale { confirmButton.padding(.horizontal, Metrics.gutter).padding(.bottom, 8) }
            }
            .navigationTitle("Record payment")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                }
            }
            .pennySolidBars()
        }
        // Medium sheets over the household, as `iphone-record-payment` and `iphone-payment-stale`
        // draw them; they grow to full height for larger text.
        .presentationDetents([.fraction(0.62), .large])
        .interactiveDismissDisabled(working)
        .accessibilityIdentifier(isMonthly ? "screen.recordMonthly" : "screen.recordShare")
    }

    private var transfer: (from: String, to: String, amount: Int64) {
        switch request {
        case .share(let expense, let from): (from, expense.payerUserId, expense.share(of: from))
        case .monthly(let transfer, _): (transfer.fromUserId, transfer.toUserId, transfer.amountCents)
        }
    }

    private var isStale: Bool { staleExpense != nil || staleSuggestions != nil }

    /// `iphone-record-payment`: who paid whom, centered (the payer, a dashed arrow, the receiver),
    /// the amount, what it settles with the Full share tag, then what recording means.
    @ViewBuilder private var details: some View {
        let people = model.people
        let transfer = transfer
        VStack(spacing: 18) {
            HStack(alignment: .top, spacing: 16) {
                personColumn(transfer.from, verb: "paid")
                DashedArrow()
                    .frame(width: 64, height: 12)
                    .padding(.top, 26)
                    .accessibilityHidden(true)
                personColumn(transfer.to, verb: transfer.to == people.meId ? "received" : "receives")
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            VStack(spacing: 8) {
                Text(MoneyFormat.amount(transfer.amount, currency: model.currency))
                    .modifier(HeroAmountFont())
                    .foregroundStyle(PennyColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .accessibilityIdentifier("payment.amount")
                Text(subtitle).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if !isMonthly {
                    HouseholdTag(text: "Full share", systemImage: "lock")
                        .accessibilityHint("The whole share is recorded; part of a share can't be")
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.top, 8)
        if let failure {
            StatusBanner(
                tone: failure.kind == .offline ? .offline : .error, title: HouseholdFailureBanner.title(failure.kind),
                message: failure.message
            )
            .accessibilityIdentifier("payment.error")
        }
        Label {
            Text(HouseholdText.recordExplanation(from: transfer.from, to: transfer.to, people: people))
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "checkmark.circle")
        }
        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
        .accessibilityIdentifier(isMonthly ? "recordMonthly.explanation" : "recordShare.explanation")
        if isMonthly, !isOpen {
            StatusBanner(
                tone: .info, title: "Opens on the last day of the month",
                message: "Monthly payments can be recorded from \(HouseholdText.monthEnd(month)). To "
                    + "repay one expense now, use Mark as paid on its share.")
        }
    }

    private var confirmButton: some View {
        PennyButton(
            working ? "Recording…" : "Mark \(MoneyFormat.amount(transfer.amount, currency: model.currency)) as paid",
            systemImage: "checkmark"
        ) {
            Task { await record() }
        }
        .disabled(working || (isMonthly && !isOpen))
        .accessibilityIdentifier(isMonthly ? "recordMonthly.confirm" : "recordShare.confirm")
    }

    private var isMonthly: Bool {
        if case .monthly = request { return true }
        return false
    }

    private var month: MonthKey {
        switch request {
        case .monthly(_, let month): month
        case .share(let expense, _): expense.calendarDate.map(MonthKey.init) ?? model.month
        }
    }

    private var isOpen: Bool {
        SettlementCalendar.monthlyPaymentsOpen(month, todayUTC: CalendarDate(now(), in: HouseholdPageCalendar.utc))
    }

    private var subtitle: String {
        switch request {
        case .share(let expense, let from):
            // "Your share of …" for you; never a capitalized email ("alex@…'s share of …").
            "\(from == model.people.meId ? "Your" : model.people.possessive(from)) share of \(expense.title) · "
                + HouseholdText.day(expense.date)
        case .monthly(_, let month):
            "The full suggested payment for \(HouseholdText.month(month)), so this month's balance between you two is settled."
        }
    }

    private func personColumn(_ userId: String, verb: String) -> some View {
        VStack(spacing: 4) {
            Monogram(initials: model.people.initials(userId), size: 64)
                .padding(.bottom, 6)
            Text(model.people.name(userId)).font(.body.weight(.semibold))
                .lineLimit(2).multilineTextAlignment(.center)
            Text(verb).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
        }
        .frame(maxWidth: 140)
        .accessibilityElement(children: .combine)
    }

    private func record() async {
        working = true
        defer { working = false }
        failure = nil
        switch request {
        case .share(let expense, let from):
            switch await model.recordShare(expense, from: from) {
            case .recorded: dismiss()
            case .stale(let old, let latest): staleExpense = (old, latest)
            case .failed(let refused): failure = refused
            }
        case .monthly(let transfer, let month):
            switch await model.recordMonthly(transfer, month: month) {
            case .recorded: dismiss()
            case .stale(let current): staleSuggestions = current
            case .failed(let refused): failure = refused
            }
        }
    }
}

enum HouseholdPageCalendar {
    static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }
}

/// The expense changed after the sheet opened. It names the real cause (another payment, often the
/// same person on another device; a monthly settlement; or an edit), lists only the values that
/// changed with the old one struck through, and offers only Review expense. Nothing was recorded.
private struct StaleExpenseView: View {
    let old: WireSharedExpense
    let latest: WireSharedExpense?
    /// The share the sheet was recording.
    let from: String
    let people: HouseholdPeople
    let currency: String
    /// The current instant, for "Mira · 2 min ago".
    let now: Date
    let review: () -> Void

    var body: some View {
        let change = latest.map { now in
            StaleShareChange(before: old, now: now, fromUserId: from) { MoneyFormat.amount($0, currency: currency) }
        }
        VStack(alignment: .leading, spacing: 16) {
            StatusBanner(tone: .error, title: title(change), message: message(change))
                .accessibilityIdentifier("screen.paymentStale")
            if let change {
                VStack(spacing: 10) {
                    ForEach(change.rows, id: \.value) { row in
                        compare(label(row.value), row)
                    }
                    if let by = by(change.cause) {
                        HStack {
                            Text(by.edited ? "Edited" : "Recorded").foregroundStyle(PennyColor.secondaryLabel)
                            Spacer()
                            Text("\(people.name(by.userId)) · \(HouseholdText.ago(by.at, now: now))")
                                .font(.body.weight(.semibold))
                                .multilineTextAlignment(.trailing)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("paymentStale.by")
                    }
                }
                .pennyCard()
            }
            PennyButton(latest == nil ? "Back to the household" : "Review expense", action: review)
                .accessibilityIdentifier("paymentStale.review")
            Text("Nothing was recorded. Recording a payment notes money already paid. Penny doesn't transfer money.")
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func title(_ change: StaleShareChange?) -> String {
        guard let change else { return "\(old.title) was deleted" }
        if case .edit = change.cause { return "\(old.title) changed" }
        return "\(old.title) payment changed"
    }

    private func message(_ change: StaleShareChange?) -> String {
        guard let change, let latest else { return "Someone deleted this expense after you opened it." }
        switch change.cause {
        case .payment(let recordedBy, let settled, _):
            let actor = people.name(recordedBy)
            guard settled == from else {
                return "\(actor) recorded a payment on this expense after you opened it. Review it before "
                    + "recording a payment."
            }
            let device = recordedBy == people.meId ? ", maybe on another device" : ""
            return "\(actor) already recorded \(people.possessive(from)) share as paid after you opened this "
                + "payment\(device). There's nothing left to record for it."
        case .monthly:
            let month = latest.calendarDate.map { HouseholdText.month(MonthKey($0)) } ?? "its month"
            return "A monthly payment was recorded for \(month) after you opened this payment, so this share now "
                + "settles with the month."
        case .edit(let editedBy, _):
            return "\(people.name(editedBy)) edited this expense after you opened it. Review it before recording "
                + "a payment."
        }
    }

    private func label(_ value: StaleShareChange.Value) -> String {
        let share = from == people.meId ? "Your share" : "\(people.name(from))'s share"
        switch value {
        case .total: return "Total"
        case .share: return share
        case .status: return "\(share) status"
        }
    }

    /// Who made the change and when (a monthly settlement names nobody).
    private func by(_ cause: StaleShareChange.Cause) -> (userId: String, at: Int64, edited: Bool)? {
        switch cause {
        case .payment(let recordedBy, _, let at): (recordedBy, at, false)
        case .edit(let editedBy, let at): (editedBy, at, true)
        case .monthly: nil
        }
    }

    private func compare(_ label: String, _ row: StaleShareChange.Row) -> some View {
        HStack {
            Text(label).foregroundStyle(PennyColor.secondaryLabel)
            Spacer()
            Text(row.before)
                .strikethrough()
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityLabel("was \(row.before)")
                .accessibilityIdentifier("paymentStale.old")
            Text(row.now).font(.body.weight(.semibold).monospacedDigit())
                .accessibilityLabel("now \(row.now)")
                .accessibilityIdentifier("paymentStale.new")
        }
        .accessibilityElement(children: .combine)
    }
}

/// The monthly suggestion changed (someone else recorded it, or an expense changed): what's
/// suggested now. Nothing was recorded.
private struct StaleMonthlyView: View {
    let suggestions: [WireTransfer]
    let people: HouseholdPeople
    let currency: String
    let review: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            StatusBanner(
                tone: .error, title: "Balances changed",
                message: "This is no longer the full suggested payment. Someone recorded a payment or changed an "
                    + "expense after you opened it."
            )
            .accessibilityIdentifier("screen.paymentStale")
            VStack(alignment: .leading, spacing: 8) {
                Text("Suggested now").font(.headline)
                if suggestions.isEmpty {
                    Text("Nothing left to settle this month.").foregroundStyle(PennyColor.secondaryLabel)
                }
                ForEach(suggestions, id: \.self) { transfer in
                    HStack {
                        Text("\(people.name(transfer.fromUserId)) → \(people.name(transfer.toUserId))")
                        Spacer()
                        MoneyText(transfer.amountCents, meaning: .neutral, currency: currency)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("paymentStale.new")
                }
            }
            .pennyCard()
            PennyButton("Review balances", action: review)
                .accessibilityIdentifier("paymentStale.review")
            Text("Nothing was recorded. Penny doesn't transfer money.")
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
        }
    }
}

/// The dashed arrow from the payer to the receiver on `iphone-record-payment`.
private struct DashedArrow: View {
    var body: some View {
        Canvas { context, size in
            let mid = size.height / 2
            var line = Path()
            line.move(to: CGPoint(x: 0, y: mid))
            line.addLine(to: CGPoint(x: size.width - 2, y: mid))
            var head = Path()
            head.move(to: CGPoint(x: size.width - 8, y: mid - 6))
            head.addLine(to: CGPoint(x: size.width - 1, y: mid))
            head.addLine(to: CGPoint(x: size.width - 8, y: mid + 6))
            let shading = GraphicsContext.Shading.color(PennyColor.tertiaryLabel)
            context.stroke(line, with: shading, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [6, 5]))
            context.stroke(head, with: shading, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
    }
}
