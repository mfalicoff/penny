import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A shared expense paid in another currency (MAZ-151 phase 2): its rate in the household's
/// currency ("1 USD = [0.9400] EUR"), what the amount comes to at it, and the published rate for
/// its date with Use the published rate. The entry form's Exchange rate sheet, for a household.
struct SharedRateSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var form: SharedExpenseFormModel
    /// The household's currency.
    let household: String
    let published: RateChoice?
    let apply: (RateChoice) -> Void
    @State private var text = ""
    @State private var error: String?
    @State private var shake = 0
    @FocusState private var focused: Bool

    var body: some View {
        let code = form.draft.paidCurrency ?? ""
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 10) {
                        Text("1 \(code) =").foregroundStyle(PennyColor.secondaryLabel)
                        TextField("Rate", text: $text)
                            .decimalEntry()
                            .focused($focused)
                            .font(.title3.weight(.bold))
                            .monospacedDigit()
                            .pennyShake(trigger: shake)
                            .accessibilityLabel("Rate, \(household) per \(code)")
                            .accessibilityIdentifier("sharedRate.field")
                        Text(household).font(.body.weight(.semibold))
                    }
                    LabeledContent("Converts to") {
                        Text(converted).monospacedDigit()
                    }
                    .accessibilityIdentifier("sharedRate.converted")
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(PennyColor.danger).accessibilityIdentifier("sharedRate.error")
                    } else {
                        Text(
                            "Each member's share is in \(household). Use the rate on your card statement or from the "
                                + "exchange counter; Penny keeps a rate you edit.")
                    }
                }
                if let published {
                    Section("Published rate") {
                        LabeledContent(
                            published.date.map { "For \(CurrencyText.mediumDay($0))" } ?? "Published",
                            value: CurrencyText.rate(published.rate))
                        Button("Use the published rate", systemImage: "arrow.clockwise") {
                            apply(published)
                            dismiss()
                        }
                        .foregroundStyle(PennyColor.tintText)
                        .accessibilityIdentifier("sharedRate.usePublished")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .navigationTitle("Exchange rate")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("sharedRate.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: done)
                        .fontWeight(.semibold)
                        .buttonStyle(.borderedProminent)
                        .tint(PennyColor.tint)
                        .accessibilityIdentifier("sharedRate.done")
                }
            }
            .pennySolidBars()
        }
        .presentationDetents([.medium, .large])
        .pennyHaptic(.refused, trigger: shake)
        .onAppear {
            text = form.draft.rate.map(CurrencyText.rate) ?? ""
            focused = form.draft.rate == nil
        }
        .accessibilityIdentifier("screen.sharedRate")
    }

    /// What the amount comes to at the typed rate.
    private var converted: String {
        var preview = form.draft
        preview.rate = try? Currencies.normalizeRate(text)
        guard let total = preview.totalCents else { return "—" }
        return "\(MoneyFormat.amount(total, currency: household)) \(household)"
    }

    private func done() {
        do {
            let rate = try Currencies.normalizeRate(text)
            if rate != form.draft.rate || form.draft.rateStatus == nil {
                apply(RateChoice(rate: rate, status: .edited))
            }
            dismiss()
        } catch {
            self.error = error.message
            shake += 1
        }
    }
}
