import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Shared trips and households in several currencies (MAZ-151 phase 2; cards
// `iphone-trip-currencies`, `ipad-trip-currencies`, `iphone-trip-balances-currency`): what a
// shared expense was paid with the viewer's amount under it, the trip's currencies chip and its
// Exchange rates, and the balances shown in another currency with Settle in.

/// Today's rates from a household's currency into others (a member's own currency, or the one
/// chosen with Settle in), read once per page. `rates[code]` is how many `code` units one unit of
/// the household's currency is worth.
@MainActor
@Observable
final class TodayRates {
    private(set) var rates: [String: String] = [:]
    private(set) var source: String?
    @ObservationIgnored private var asked: Set<String> = []

    /// Reads the rate of `from` into each of `targets` not read yet.
    func load(from: String, targets: [String], today: CalendarDate, model: ExchangeRateModel) async {
        for code in targets where code != from && !asked.contains("\(from)>\(code)") {
            asked.insert("\(from)>\(code)")
            if case .found(let choice, let source) = await model.lookup(from, base: code, date: today) {
                rates[code] = choice.rate
                self.source = self.source ?? source
            }
        }
    }

    /// `minor` units of `from` in `code` at today's rate; nil without a rate.
    func convert(_ minor: Int64, from: String, to code: String) -> Int64? {
        if code == from { return minor }
        guard let rate = rates[code], minor != .min,
            let converted = try? Currencies.convertAmount(abs(minor), from: from, rate: rate, home: code)
        else { return nil }
        return minor < 0 ? -converted : converted
    }
}

/// What a shared expense was paid ("€120.00", "US$600.00") over the viewer's amount in their own
/// currency: "$373.25", or "≈ $175.56" in amber while its rate is provisional. Nothing under it
/// when it was paid in the viewer's currency. Without a home amount, `fallback` (your part of it).
struct SharedPaidAmount: View {
    let amounts: SharedExpenseAmounts
    var fallback: String?
    var style: Font = .callout.weight(.semibold)

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(CurrencyText.amount(amounts.paid, code: amounts.paidCurrency, home: amounts.home))
                .font(style).monospacedDigit()
                .foregroundStyle(PennyColor.label)
            if amounts.showsHome, let total = amounts.homeTotal {
                let text = MoneyFormat.amount(total, currency: amounts.home)
                Text(amounts.provisional ? "≈ \(text)" : text)
                    .font(.footnote.weight(amounts.provisional ? .semibold : .regular)).monospacedDigit()
                    .foregroundStyle(amounts.provisional ? PennyColor.pending : PennyColor.secondaryLabel)
                    .accessibilityLabel(
                        amounts.provisional ? "about \(text), provisional rate" : "\(text) in your currency")
            } else if let fallback {
                Text(fallback).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .fixedSize()
    }
}

/// The trip's currencies under its totals: "EUR, USD and CAD · each at its date's rate", which
/// opens the Exchange rates.
struct SharedTripCurrencyChip: View {
    let codes: [String]
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                Image(systemName: "banknote").imageScale(.small).accessibilityHidden(true)
                Text(TripCurrencyText.chip(codes)).lineLimit(1).minimumScaleFactor(0.8)
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).accessibilityHidden(true)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(PennyColor.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows the exchange rates")
        .accessibilityIdentifier("tripPage.currencies")
    }
}

/// One currency the trip's expenses were paid in, as the Exchange rates panel lists it.
struct SharedTripCurrencyTotal: Equatable {
    let code: String
    let count: Int
    /// What was paid in `code`.
    let paid: Int64
    /// The same in the viewer's currency, when every expense in it could be converted.
    let home: Int64?
}

extension SharedTripCurrencyTotal {
    /// The trip's currencies in chip order, with what was paid in each and its home amount.
    static func list(
        _ expenses: [WireSharedExpense], householdCurrency: String, home: String, meId: String?
    ) -> [SharedTripCurrencyTotal] {
        let amounts = expenses.map { $0.amounts(householdCurrency: householdCurrency, home: home, meId: meId) }
        return SharedTripCurrencies.list(expenses, householdCurrency: householdCurrency, home: home).map { code in
            let paidIn = amounts.filter { $0.paidCurrency == code }
            let totals = paidIn.map(\.homeTotal)
            return SharedTripCurrencyTotal(
                code: code, count: paidIn.count, paid: paidIn.reduce(0) { $0 + $1.paid },
                home: totals.contains(nil) ? nil : totals.reduce(0) { $0 + ($1 ?? 0) })
        }
    }
}

/// `ipad-trip-currencies`' Exchange rates: each currency the trip's expenses were paid in, with
/// how many, what was paid and its amount in your currency, then how the rates work. On iPad it
/// is a panel beside the expenses; on iPhone the chip opens it as a sheet.
struct SharedTripRatesSection: View {
    let context: SharedTripContext
    let model: HouseholdModel
    var source: String?

    var body: some View {
        let expenses = context.expenses?.loadedExpenses ?? []
        let home = context.home
        let totals = SharedTripCurrencyTotal.list(
            expenses, householdCurrency: model.currency, home: home, meId: model.people.meId)
        let provisional = expenses.filter {
            $0.amounts(householdCurrency: model.currency, home: home, meId: model.people.meId).provisional
        }
        .map(\.title)
        Section {
            PanelTitle("Exchange rates")
            ForEach(totals, id: \.code) { item in
                HStack(spacing: 12) {
                    Text(item.code).font(.body.weight(.bold)).frame(minWidth: 48, alignment: .leading)
                    Text(TripCurrencyText.rateDetail(item.code, count: item.count))
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(CurrencyText.amount(item.paid, code: item.code, home: home))
                            .font(.callout.weight(.semibold)).monospacedDigit()
                        Group {
                            if item.code == home {
                                Text("your currency")
                            } else if let converted = item.home {
                                Text("≈ \(MoneyFormat.amount(converted, currency: home))").monospacedDigit()
                            }
                        }
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .fixedSize()
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("tripPage.rate.\(item.code)")
            }
            Text(TripCurrencyText.ratesNote(home: home, source: source, provisional: provisional))
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("tripPage.ratesNote")
        }
    }
}

/// The Exchange rates as a sheet, from the chip on iPhone.
struct SharedTripRatesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ShellModel.self) private var shell
    let context: SharedTripContext
    let model: HouseholdModel

    var body: some View {
        NavigationStack {
            List {
                SharedTripRatesSection(
                    context: context, model: model, source: shell.rates.latest[context.home]?.source)
            }
            .insetGroupedList()
            .background(PennyColor.background)
            .navigationTitle("Exchange rates")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("tripRates.close")
                }
            }
            .pennySolidBars()
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("screen.tripRates")
    }
}

/// "Settle in EUR ⌄": the currencies balances and payments can show in.
struct SettleInMenu: View {
    let options: [String]
    @Binding var selection: String

    var body: some View {
        Menu {
            Picker("Settle in", selection: $selection) {
                ForEach(options, id: \.self) { code in
                    Text("\(code) · \(Currencies.info(code)?.name ?? code)").tag(code)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(TripCurrencyText.settleIn(selection))
                Image(systemName: "chevron.down").font(.caption2.weight(.bold)).accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(PennyColor.tintText)
            .textCase(nil)
        }
        .accessibilityLabel(TripCurrencyText.settleIn(selection))
        .accessibilityHint("Choose the currency balances and payments show in")
        .accessibilityIdentifier("household.settleIn")
    }
}
