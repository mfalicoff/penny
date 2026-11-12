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
                            old: staleExpense.old, latest: staleExpense.latest, people: model.people,
                            currency: model.currency
                        ) { dismiss() }
                        .accessibilityIdentifier("screen.paymentStale")
                    } else if let staleSuggestions {
                        StaleMonthlyView(
                            suggestions: staleSuggestions, people: model.people, currency: model.currency
                        ) { dismiss() }
                        .accessibilityIdentifier("screen.paymentStale")
                    } else {
                        details
                    }
                }
                .padding(Metrics.gutter)
            }
            .background(PennyColor.background)
            .navigationTitle("Record payment")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(working)
        .accessibilityIdentifier(isMonthly ? "screen.recordMonthly" : "screen.recordShare")
    }

    private var transfer: (from: String, to: String, amount: Int64) {
        switch request {
        case .share(let expense, let from): (from, expense.payerUserId, expense.share(of: from))
        case .monthly(let transfer, _): (transfer.fromUserId, transfer.toUserId, transfer.amountCents)
        }
    }

    @ViewBuilder private var details: some View {
        let people = model.people
        let transfer = transfer
        VStack(alignment: .leading, spacing: 14) {
            personLine(transfer.from, verb: "paid")
            personLine(transfer.to, verb: transfer.to == people.meId ? "received" : "receives")
            HeroAmount("Amount", cents: transfer.amount, currency: model.currency)
            Text(subtitle).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
        }
        .pennyCard()
        if let failure {
            StatusBanner(
                tone: failure.kind == .offline ? .offline : .error, title: HouseholdFailureBanner.title(failure.kind),
                message: failure.message
            )
            .accessibilityIdentifier("payment.error")
        }
        Text(HouseholdText.recordExplanation(payer: people.name(transfer.from)))
            .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(isMonthly ? "recordMonthly.explanation" : "recordShare.explanation")
        if isMonthly, !isOpen {
            StatusBanner(
                tone: .info, title: "Opens on the last day of the month",
                message: "Monthly payments can be recorded from \(HouseholdText.monthEnd(month)). To "
                    + "repay one expense now, use Mark as paid on its share.")
        }
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
        SettlementCalendar.monthlyPaymentsOpen(month, todayUTC: CalendarDate(Date(), in: HouseholdPageCalendar.utc))
    }

    private var subtitle: String {
        switch request {
        case .share(let expense, let from):
            "\(model.people.possessive(from).capitalizedFirst) share of \(expense.title) · "
                + "\(HouseholdText.day(expense.date)) · Full share"
        case .monthly(_, let month):
            "The full suggested payment for \(HouseholdText.month(month)), so this month's balance between you two is settled."
        }
    }

    private func personLine(_ userId: String, verb: String) -> some View {
        HStack(spacing: 10) {
            Monogram(initials: model.people.initials(userId))
            Text("\(model.people.name(userId)) \(verb)").font(.body.weight(.semibold))
        }
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

/// The expense changed after the sheet opened: old and new total and share, who edited it and
/// when, and only Review expense. Nothing was recorded.
private struct StaleExpenseView: View {
    let old: WireSharedExpense
    let latest: WireSharedExpense?
    let people: HouseholdPeople
    let currency: String
    let review: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            StatusBanner(
                tone: .error, title: latest == nil ? "\(old.title) was deleted" : "\(old.title) changed",
                message: latest.map {
                    "\(people.name($0.updatedBy)) edited this expense after you opened it. Review it before "
                        + "recording a payment."
                } ?? "Someone deleted this expense after you opened it.")
            if let latest {
                VStack(spacing: 10) {
                    compare("Total", old.totalCents, latest.totalCents)
                    compare("Your share", old.share(of: people.meId), latest.share(of: people.meId))
                    LabeledContent(
                        "Edited",
                        value:
                            "\(people.name(latest.updatedBy)) · \(HouseholdText.instant(latest.updatedAt).formatted(.relative(presentation: .named)))"
                    )
                }
                .pennyCard()
            }
            PennyButton(latest == nil ? "Back to the household" : "Review expense", systemImage: "eye", action: review)
                .accessibilityIdentifier("paymentStale.review")
            Text("Nothing was recorded. Recording a payment notes money already paid. Penny doesn't transfer money.")
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func compare(_ label: String, _ before: Int64, _ after: Int64) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(MoneyFormat.amount(before, currency: currency))
                .strikethrough()
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityLabel("was \(MoneyFormat.amount(before, currency: currency))")
                .accessibilityIdentifier("paymentStale.old")
            Text(MoneyFormat.amount(after, currency: currency)).font(.body.weight(.semibold).monospacedDigit())
                .accessibilityLabel("now \(MoneyFormat.amount(after, currency: currency))")
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
                    + "expense after you opened it.")
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
            PennyButton("Review balances", systemImage: "eye", action: review)
                .accessibilityIdentifier("paymentStale.review")
            Text("Nothing was recorded. Penny doesn't transfer money.")
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
        }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
