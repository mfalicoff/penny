import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Entries in several currencies (MAZ-151; `iphone-entry-currency`, `iphone-currency-picker`,
// `iphone-entry-rate-provisional`, `iphone-entry-rate-edited`, `iphone-entry-rate-manual`,
// `ipad-add-entry-currency`): the currency chip with the converted home amount under the entry
// form's amount, the Rate row and its note, the currency picker and the Exchange rate sheet.

/// What the entry form knows about its rate beyond the draft: whether a lookup runs, who published
/// the rate, the published rate for the entry's date, and whether the server fetches rates at all.
struct EntryRateState: Equatable {
    var loading = false
    var source: String?
    var published: RateChoice?
    /// The server doesn't fetch rates (`iphone-entry-rate-manual`).
    var off = false
    /// The last lookup found no rate for this currency (offline with nothing kept, or unquoted).
    var unavailable = false
}

/// The chip under the amount ("EUR ⌄", copper on its soft tint) and what the amount converts to
/// ("≈ $124.20 CAD", or "Enter a rate to convert" while there's no rate).
struct EntryCurrencyLine: View {
    let draft: EntryDraft
    let home: Currency
    let loading: Bool
    let choose: () -> Void

    var body: some View {
        let code = draft.currency ?? home.rawValue
        let foreign = draft.foreignCurrency(home: home) != nil
        HStack(spacing: 10) {
            Button(action: choose) {
                HStack(spacing: 4) {
                    Text(code).pennyCrossfade(code, duration: .quick)
                    Image(systemName: "chevron.down").font(.caption2.weight(.bold)).accessibilityHidden(true)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(foreign ? PennyColor.tintText : PennyColor.secondaryLabel)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(foreign ? PaletteToken.tintSoft.value.color : PennyColor.fill, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Currency, \(Currencies.info(code)?.name ?? code)")
            .accessibilityHint("Choose the currency you paid in")
            .accessibilityIdentifier("entryForm.currency")
            if foreign {
                Group {
                    if let total = draft.convertedTotal(home: home) {
                        // Each keystroke shows the new amount at once, with tabular figures.
                        Text("≈ \(MoneyFormat.amount(total, currency: home.rawValue)) \(home.rawValue)")
                            .monospacedDigit()
                            .accessibilityLabel(
                                "About \(MoneyFormat.amount(total, currency: home.rawValue)) \(home.rawValue)")
                    } else {
                        Text("Enter a rate to convert")
                    }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .opacity(loading ? 0.5 : 1)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .accessibilityIdentifier("entryForm.converted")
            }
        }
    }
}

/// The entry form's Rate row: "1 EUR = 1.4612 CAD" over where it comes from, the Provisional or
/// Edited tag, or "Enter rate" with the last rate used for the currency. While a new rate is
/// looked up the old one stays, dimmed, with no spinner.
struct EntryRateRow: View {
    let draft: EntryDraft
    let home: Currency
    let state: EntryRateState
    let lastUsed: String?
    let height: Double
    let open: () -> Void

    var body: some View {
        let code = draft.currency ?? ""
        Button(action: open) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.left.arrow.right")
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                Text("Rate").foregroundStyle(PennyColor.label).layoutPriority(1)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    if let rate = draft.rate {
                        Text(CurrencyText.rateLine(code, rate: rate, home: home.rawValue))
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(PennyColor.label)
                            .monospacedDigit()
                            .pennyCrossfade(rate)
                        detail
                    } else {
                        Text("Enter rate").font(.callout.weight(.semibold)).foregroundStyle(PennyColor.tintText)
                        if let lastUsed {
                            Text("Last used: \(CurrencyText.rateLine(code, rate: lastUsed, home: home.rawValue))")
                                .font(.caption)
                                .foregroundStyle(PennyColor.secondaryLabel)
                        }
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .opacity(state.loading ? 0.5 : 1)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityHidden(true)
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: max(height, 56))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the exchange rate")
        .accessibilityIdentifier("entryForm.rate")
    }

    @ViewBuilder private var detail: some View {
        switch draft.rateStatus {
        case .provisional?:
            HStack(spacing: 6) {
                HouseholdTag(text: "Provisional", systemImage: "clock", tone: .pending)
                    .transition(.opacity)
                if let date = draft.rateDate {
                    Text(CurrencyText.mediumDay(date)).font(.caption).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
        case .edited?:
            HStack(spacing: 6) {
                HouseholdTag(text: "Edited", systemImage: "square.and.pencil", tone: .neutral)
                    .transition(.opacity)
                Text("Your rate").font(.caption).foregroundStyle(PennyColor.secondaryLabel)
            }
        case .published?, nil:
            Text(CurrencyText.source(state.source, date: draft.rateDate))
                .font(.caption)
                .foregroundStyle(PennyColor.secondaryLabel)
        }
    }
}

/// The line under the rows: why a rate is provisional, or that the server doesn't fetch rates.
struct EntryRateNote: View {
    let draft: EntryDraft
    let state: EntryRateState
    let today: CalendarDate

    var body: some View {
        if let note {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: note.symbol)
                    .font(.footnote)
                    .foregroundStyle(note.tone)
                    .accessibilityHidden(true)
                Text(note.text)
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .transition(.opacity)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("entryForm.rateNote")
        }
    }

    private var note: (text: String, symbol: String, tone: Color)? {
        guard draft.currency != nil else { return nil }
        if draft.rateStatus == .provisional, let date = CalendarDate.ledgerDate(draft.date) {
            return (
                CurrencyText.provisionalNote(entryDate: date, rateDate: draft.rateDate, today: today), "clock",
                PennyColor.pending
            )
        }
        if draft.rate == nil, state.off { return (CurrencyText.ratesOffNote, "cylinder", PennyColor.secondaryLabel) }
        if draft.rate == nil, state.unavailable {
            return (CurrencyText.noRateNote, "cylinder", PennyColor.secondaryLabel)
        }
        return nil
    }
}

/// `iphone-currency-picker`: search by code, name or country; Suggested (the entry's currency and
/// the home currency), Recent (the ones the ledger used last) and every ISO 4217 currency A–Z,
/// each with its symbol and "No decimals" for a currency without minor units.
struct CurrencyPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let selection: String
    /// The viewer's home currency (or, in a shared form, the household's).
    let home: String
    /// The trip's currency, Suggested first: the default for a trip entry (MAZ-151 phase 2).
    var trip: String? = nil
    let recent: [String]
    let choose: (String) -> Void
    @State private var query = ""

    var body: some View {
        let needle = SearchText.normalize(query)
        let suggested = Self.suggested(selection: selection, home: home, trip: trip)
        let recents = recent.filter { !suggested.contains($0) }.prefix(4)
        NavigationStack {
            List {
                if needle.isEmpty {
                    CardSection("Suggested") {
                        ForEach(suggested, id: \.self) { code in row(code, note: note(code)) }
                    } footer: {
                        EmptyView()
                    }
                    if !recents.isEmpty {
                        CardSection("Recent") {
                            ForEach(Array(recents), id: \.self) { code in row(code, note: decimalsNote(code)) }
                        } footer: {
                            EmptyView()
                        }
                    }
                    ForEach(Self.letters, id: \.self) { letter in
                        let codes = Currencies.all.filter { $0.code.hasPrefix(letter) }
                        Section {
                            ForEach(codes) { info in row(info.code, note: decimalsNote(info.code)) }
                        } header: {
                            if letter == Self.letters.first {
                                Text("All currencies").cardSectionHeader()
                            }
                        }
                        .sectionIndex(letter)
                    }
                } else {
                    let matches = Self.matches(needle)
                    CardSection("Results") {
                        ForEach(matches) { info in row(info.code, note: decimalsNote(info.code)) }
                    } footer: {
                        if matches.isEmpty { Text("No currency matches “\(query)”.") }
                    }
                }
            }
            .insetGroupedList()
            .compactSections()
            // Solid groups on the page background, as on the card.
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .searchableAtTop(text: $query, prompt: "Search currencies or countries")
            .navigationTitle("Currency")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("currencyPicker.close")
                }
            }
            .pennySolidBars()
        }
        .presentationDetents([.large])
        .accessibilityIdentifier("screen.currencyPicker")
    }

    static let letters: [String] = Array(Set(Currencies.all.map { String($0.code.prefix(1)) })).sorted()

    /// The trip's currency, the entry's (when it isn't home), then the home currency, each once.
    static func suggested(selection: String, home: String, trip: String? = nil) -> [String] {
        var codes: [String] = []
        for code in [trip, selection, home].compactMap(\.self) where !codes.contains(code) { codes.append(code) }
        return codes
    }

    /// Currencies whose code, name or countries contain `needle` (already normalized).
    static func matches(_ needle: String) -> [CurrencyInfo] {
        Currencies.all.filter { info in
            [info.code, info.name, info.countries].contains { SearchText.normalize($0).contains(needle) }
        }
    }

    /// The note on `home` in Suggested.
    var homeNote = "Your home currency"
    /// The note on `trip` in Suggested.
    var tripNote = "This trip's currency"

    /// The picker with `note` on the trip's currency ("Lisbon's currency"), when there is one.
    func tripNote(_ note: String?) -> Self {
        var copy = self
        if let note { copy.tripNote = note }
        return copy
    }

    private func note(_ code: String) -> String? {
        code == trip ? tripNote : code == home ? homeNote : decimalsNote(code)
    }

    private func decimalsNote(_ code: String) -> String? {
        switch Currencies.info(code)?.minorUnits {
        case 0?: "No decimals"
        case 3?: "Three decimals"
        default: nil
        }
    }

    private func row(_ code: String, note: String?) -> some View {
        let selected = code == selection
        let name = Currencies.info(code)?.name ?? code
        return Button {
            choose(code)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Text(code).font(.body.weight(.bold)).foregroundStyle(PennyColor.label).frame(
                    width: 54, alignment: .leading)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.body).foregroundStyle(PennyColor.label)
                    if let note {
                        Text(note).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                Spacer(minLength: 8)
                Text(CurrencyText.pickerSymbol(code, home: home)).foregroundStyle(PennyColor.secondaryLabel)
                if selected {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(PennyColor.tint)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // The card's compact rows.
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(PennyColor.surface)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(code), \(name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("currencyPicker.option.\(code)")
    }
}

extension View {
    /// Tight gaps between the picker's A–Z sections (iOS); nothing elsewhere.
    @ViewBuilder
    fileprivate func compactSections() -> some View {
        #if os(iOS)
            listSectionSpacing(.compact)
        #else
            self
        #endif
    }

    /// The list's A–Z index letter for a section (iOS 26); nothing elsewhere.
    @ViewBuilder
    fileprivate func sectionIndex(_ letter: String) -> some View {
        #if os(iOS)
            sectionIndexLabel(Text(letter))
        #else
            self
        #endif
    }
}

/// `iphone-entry-rate-edited`: the rate typed as on the card statement ("1 EUR = [1.4900] CAD"),
/// what the amount converts to at it, and the published rate for the entry's date with **Use the
/// published rate**. With fetching off it offers the last rate used for the currency instead.
/// The system sheet at its medium detent.
struct ExchangeRateSheet: View {
    @Environment(\.dismiss) private var dismiss
    let draft: EntryDraft
    let home: Currency
    let published: RateChoice?
    let source: String?
    let lastUsed: String?
    /// A typed rate (`.edited`), the published one, or the last used (typed again).
    let apply: (RateChoice) -> Void
    @State private var text = ""
    @State private var error: String?
    @State private var shake = 0
    @State private var picked = 0
    @FocusState private var focused: Bool

    var body: some View {
        let code = draft.currency ?? ""
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(heading).cardSectionHeader()
                        Spacer()
                        if draft.rateStatus == .edited {
                            HouseholdTag(text: "Edited", systemImage: "square.and.pencil")
                                .accessibilityIdentifier("exchangeRate.edited")
                        }
                    }
                    .padding(.horizontal, 16)
                    VStack(spacing: 0) {
                        HStack(spacing: 10) {
                            Text("1 \(code) =").foregroundStyle(PennyColor.secondaryLabel)
                            TextField("Rate", text: $text)
                                .decimalEntry()
                                .focused($focused)
                                .font(.title2.weight(.bold))
                                .monospacedDigit()
                                .padding(.horizontal, 12)
                                .frame(minHeight: 52)
                                .background(
                                    PennyColor.secondarySurface,
                                    in: RoundedRectangle(cornerRadius: Metrics.fieldRadius, style: .continuous)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: Metrics.fieldRadius, style: .continuous)
                                        .strokeBorder(
                                            error == nil ? PennyColor.tint : PennyColor.danger, lineWidth: 1.5)
                                )
                                .tint(PennyColor.tint)
                                .pennyShake(trigger: shake)
                                .accessibilityLabel("Rate, \(home.rawValue) per \(code)")
                                .accessibilityIdentifier("exchangeRate.field")
                            Text(home.rawValue).font(.body.weight(.semibold))
                        }
                        .font(.body)
                        .padding(.vertical, 14)
                        Divider()
                        HStack {
                            Text("\(originalText) converts to").foregroundStyle(PennyColor.secondaryLabel)
                            Spacer(minLength: 8)
                            Text(convertedText).font(.body.weight(.semibold)).monospacedDigit()
                        }
                        .padding(.vertical, 14)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("exchangeRate.converted")
                    }
                    .padding(.horizontal, 16)
                    .background(
                        PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(PennyColor.danger).padding(.horizontal, 16)
                            .accessibilityIdentifier("exchangeRate.error")
                    }
                    Text(
                        "Use the rate on your card statement or from the exchange counter. Penny keeps a rate you edit: sync and date changes never replace it."
                    )
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    if let published {
                        reference(
                            title: "Published rate", name: source ?? "Published rate",
                            detail: published.date.map { "For \(CurrencyText.mediumDay($0))" }, rate: published.rate,
                            action: "Use the published rate", symbol: "arrow.clockwise", published: true
                        ) {
                            picked += 1
                            apply(published)
                            dismiss()
                        }
                    } else if let lastUsed {
                        reference(
                            title: "Last used", name: "Your last rate",
                            detail: "For \(Currencies.info(code)?.name ?? code)",
                            rate: lastUsed, action: "Use the last rate", symbol: "arrow.uturn.backward",
                            published: false
                        ) {
                            text = CurrencyText.rate(lastUsed)
                            error = nil
                        }
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 12)
            }
            .background(PennyColor.background)
            .navigationTitle("Exchange rate")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("exchangeRate.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: done)
                        .fontWeight(.semibold)
                        .buttonStyle(.borderedProminent)
                        .tint(PennyColor.tint)
                        .accessibilityIdentifier("exchangeRate.done")
                }
            }
            .pennySolidBars()
        }
        .presentationDetents([.medium, .large])
        .pennyHaptic(.select, trigger: picked)
        .pennyHaptic(.refused, trigger: shake)
        .onAppear {
            text = draft.rate.map(CurrencyText.rate) ?? ""
            focused = draft.rate == nil
        }
        .accessibilityIdentifier("screen.exchangeRate")
    }

    private var heading: String {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let day = CalendarDate.ledgerDate(draft.date).map(CurrencyText.mediumDay)
        return [title.isEmpty ? nil : title, day].compactMap(\.self).joined(separator: " · ")
    }

    private var typedRate: String? { try? Currencies.normalizeRate(text) }

    private var originalText: String {
        guard let code = draft.currency, let amount = try? Currencies.parseAmount(draft.amount, currency: code) else {
            return "The amount"
        }
        return CurrencyText.amount(amount, code: code, home: home.rawValue)
    }

    private var convertedText: String {
        var preview = draft
        preview.rate = typedRate
        guard let total = preview.convertedTotal(home: home) else { return "—" }
        return "\(MoneyFormat.amount(total, currency: home.rawValue)) \(home.rawValue)"
    }

    private func reference(
        title: String, name: String, detail: String?, rate: String, action: String, symbol: String, published: Bool,
        perform: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).cardSectionHeader().padding(.horizontal, 16)
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name).font(.body)
                        if let detail { Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel) }
                    }
                    Spacer()
                    Text(CurrencyText.rate(rate)).foregroundStyle(PennyColor.secondaryLabel).monospacedDigit()
                }
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
                Divider()
                Button(action: perform) {
                    Label(action, systemImage: symbol)
                        .font(.body)
                        .foregroundStyle(PennyColor.tintText)
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(published ? "exchangeRate.usePublished" : "exchangeRate.useLast")
            }
            .padding(.horizontal, 16)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        }
    }

    private func done() {
        do {
            let rate = try Currencies.normalizeRate(text)
            if rate != draft.rate || draft.rateStatus == nil {
                picked += 1
                apply(RateChoice(rate: rate, status: .edited))
            }
            dismiss()
        } catch {
            self.error = error.message
            shake += 1
        }
    }
}
