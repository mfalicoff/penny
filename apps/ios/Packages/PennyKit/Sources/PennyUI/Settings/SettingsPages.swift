import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Appearance (`appearance` card, and the page beside the list on `ipad-settings`): Light, Dark and
/// System as three previews (MAZ-180); Display (MAZ-250: Show cents on Home, Reduce transparency,
/// Week starts on, as on the web); text size follows the device. All stay on this device.
struct AppearanceSettingsView: View {
    @Environment(AppearanceModel.self) private var appearance
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// The card's order: Light, Dark, System.
    static let options: [AppearancePreference] = [.light, .dark, .system]

    var body: some View {
        List {
            Section {
                // Side by side, as on the card; one under another at accessibility text sizes.
                let layout =
                    typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(spacing: 16)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
                layout {
                    ForEach(Self.options, id: \.self) { option in choice(option) }
                }
                .padding(.vertical, 8)
            } header: {
                Text("Theme").cardSectionHeader()
            } footer: {
                // The iPad card's shorter footnote, as on the web's tablet layout.
                Text(
                    sizeClass == .regular
                        ? "System follows your \(SyncBanner.deviceName)'s Light and Dark setting. Dark mode uses true black."
                        : "System follows your \(SyncBanner.deviceName)'s Light and Dark setting, including scheduled switching. "
                            + "Dark mode uses true black.")
            }
            Section {
                switchRow(
                    "Show cents on Home",
                    detail: "Left to spend shows \(Self.centsExample) instead of \(Self.wholeExample).",
                    isOn: Binding(get: { appearance.showsCents }, set: { appearance.setShowsCents($0) })
                )
                .accessibilityIdentifier("appearance.showCents")
                switchRow(
                    "Reduce transparency",
                    detail:
                        // Narrower than the card: iOS keeps the tab bar and the buttons in the bars glass
                        // unless the device's own setting is on (design decision on MAZ-250).
                        "Use solid navigation bars and controls instead of glass. "
                        + "Your \(SyncBanner.deviceName)'s own setting also covers the tab bar and the bars' buttons.",
                    isOn: Binding(
                        get: { appearance.reducesTransparency }, set: { appearance.setReducesTransparency($0) })
                )
                .accessibilityIdentifier("appearance.reduceTransparency")
                Picker(
                    "Week starts on",
                    selection: Binding(get: { appearance.weekStart }, set: { appearance.setWeekStart($0) })
                ) {
                    ForEach(WeekStart.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(PennyColor.secondaryLabel)
                .cardSettingsRow()
                .accessibilityIdentifier("appearance.weekStart")
            } header: {
                Text("Display").cardSectionHeader()
            }
            Section {
                LabeledContent("Text size", value: "Follows \(SyncBanner.deviceName)")
            } header: {
                Text("Text").cardSectionHeader()
            } footer: {
                // The iPad card has no footnote here.
                if sizeClass != .regular {
                    Text(
                        "Penny supports Dynamic Type. Change text size in \(SyncBanner.deviceName) Settings › Display & Brightness."
                    )
                }
            }
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle("Appearance")
        .accessibilityIdentifier("screen.appearance")
    }

    /// The card's example amounts, in the device's currency format.
    static var centsExample: String { MoneyFormat.amount(111_665, currency: exampleCurrency) }
    static var wholeExample: String { MoneyFormat.whole(111_665, currency: exampleCurrency) }
    private static var exampleCurrency: String { Locale.current.currency?.identifier ?? "USD" }

    /// A switch with a title and a line under it (the card's `.sr` with `small`).
    private func switchRow(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(PennyColor.tint)
        .cardSettingsRow()
    }

    private func choice(_ option: AppearancePreference) -> some View {
        let selected = appearance.preference == option
        return Button {
            appearance.set(option)
        } label: {
            VStack(spacing: 8) {
                ThemePreview(option: option)
                Text(option.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(PennyColor.label)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(selected ? PennyColor.tint : PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(option.title)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("appearance.\(option.rawValue)")
    }
}

/// A small phone drawn in one appearance, at the card's size (`iphone-appearance`'s `.mini`:
/// 82×150pt, a 16pt corner and a 1.5pt edge): the glow, a title and subtitle, two cards and the tab
/// bar. System shows light and dark halves.
private struct ThemePreview: View {
    let option: AppearancePreference

    static let size = CGSize(width: 82, height: 150)

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        Group {
            switch option {
            case .light: screen.environment(\.colorScheme, .light)
            case .dark: screen.environment(\.colorScheme, .dark)
            case .system:
                screen.environment(\.colorScheme, .light)
                    .overlay {
                        screen.environment(\.colorScheme, .dark)
                            .mask(alignment: .trailing) {
                                Rectangle().frame(width: Self.size.width / 2)
                            }
                    }
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .clipShape(shape)
        .overlay(shape.strokeBorder(PennyColor.separator, lineWidth: 1.5))
        .accessibilityHidden(true)
    }

    /// The card's boxes, placed from the top left as on the card.
    private var screen: some View {
        ZStack(alignment: .topLeading) {
            PennyColor.background
            Ellipse()
                .fill(Color(red: 1, green: 138 / 255, blue: 76 / 255).opacity(0.45))
                .frame(width: 90, height: 70)
                .blur(radius: 12)
                .offset(x: -10, y: -20)
            RoundedRectangle(cornerRadius: 4).fill(PennyColor.label)
                .frame(width: 44, height: 11).offset(x: 9, y: 22)
            RoundedRectangle(cornerRadius: 4).fill(PennyColor.tertiaryLabel)
                .frame(width: 30, height: 5).offset(x: 9, y: 38)
            RoundedRectangle(cornerRadius: 7, style: .continuous).fill(PennyColor.surface)
                .frame(width: Self.size.width - 14, height: 28).offset(x: 7, y: 54)
            RoundedRectangle(cornerRadius: 7, style: .continuous).fill(PennyColor.surface)
                .frame(width: Self.size.width - 14, height: 34).offset(x: 7, y: 88)
            Capsule().fill(PennyColor.surface.opacity(0.85))
                .frame(width: Self.size.width - 14, height: 14).offset(x: 7, y: Self.size.height - 21)
        }
        .frame(width: Self.size.width, height: Self.size.height, alignment: .topLeading)
    }
}

/// Currency (`settings` card's Currency row; `iphone-currency-rates`, `iphone-currency-rates-off`,
/// `ipad-settings-currency`, MAZ-151): the home currency every total adds up in (one of the four the
/// API accepts, locked once entries exist or while in a household), the server's exchange rates
/// (daily ECB rates and their latest date, or "Turned off on this server" with your last rates),
/// and the currencies your entries used.
struct CurrencySettingsView: View {
    @Environment(ShellModel.self) private var shell
    @State private var failure: SaveFailure?
    @State private var saving: Currency?

    var body: some View {
        WorkspaceContent { ledger in
            let lockReason = CurrencyPolicy.lockReason(ledger: ledger)
            let usage = CurrencyUsage(ledger)
            List {
                if let failure {
                    Section {
                        SaveErrorBanner(failure: failure, retry: saving.map { currency in { choose(currency) } })
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                Section {
                    if lockReason != nil {
                        // Locked: the home currency alone, with its lock (`iphone-currency-rates`).
                        HStack(spacing: 12) {
                            Text(ledger.currency.rawValue).font(.body.weight(.bold)).frame(
                                width: 54, alignment: .leading)
                            Text(Currencies.info(ledger.currency.rawValue)?.name ?? "")
                            Spacer()
                            Image(systemName: "lock").foregroundStyle(PennyColor.tertiaryLabel)
                                .accessibilityLabel("Locked")
                        }
                        .frame(minHeight: Metrics.minTouchTarget)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isSelected)
                        .accessibilityIdentifier("currencySettings.home.\(ledger.currency.rawValue)")
                    } else {
                        ForEach(CurrencyPolicy.options, id: \.self) { currency in option(currency, ledger: ledger) }
                    }
                } header: {
                    Text("Home currency").cardSectionHeader()
                } footer: {
                    Text(
                        lockReason == LedgerRuleError.currencyLocked.message
                            ? Self.lockedFooter(ledger.currency)
                            : Self.footer(lockReason)
                                ?? "Choose your currency before adding entries. One currency per account keeps your totals consistent."
                    )
                }
                exchangeRates(ledger.currency, usage: usage)
                if !usage.uses.isEmpty {
                    Section {
                        ForEach(usage.uses, id: \.code) { use in
                            HStack(spacing: 12) {
                                Text(use.code).font(.body.weight(.bold)).frame(width: 54, alignment: .leading)
                                Text(Currencies.info(use.code)?.name ?? use.code)
                                Spacer()
                                Text(CurrencyText.used(use.count)).foregroundStyle(PennyColor.secondaryLabel)
                            }
                            .frame(minHeight: Metrics.minTouchTarget)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("currencySettings.recent.\(use.code)")
                        }
                    } header: {
                        Text("Recent currencies").cardSectionHeader()
                    }
                }
            }
            .insetGroupedList()
            // The list sits right under the bar, as on the card.
            .contentMargins(.top, 8, for: .scrollContent)
            .task { await shell.rates.refresh(home: ledger.currency) }
        }
        .background(PennyColor.background)
        .navigationTitle("Currency")
        .accessibilityIdentifier("screen.currency")
    }

    /// Exchange rates: Daily rates On (the source's reference rates) and Latest rates, or Off
    /// ("Turned off on this server") and your last rates.
    @ViewBuilder
    private func exchangeRates(_ home: Currency, usage: CurrencyUsage) -> some View {
        let answer = shell.rates.latest[home.rawValue]
        let on = answer?.enabled ?? shell.rates.isAvailable
        Section {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Daily rates")
                    Text(
                        on
                            ? "\(answer?.source ?? "European Central Bank") reference rates"
                            : "Turned off on this server"
                    )
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer()
                Text(on ? "On" : "Off").foregroundStyle(PennyColor.secondaryLabel)
            }
            .frame(minHeight: Metrics.minTouchTarget)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("currencySettings.dailyRates")
            if on {
                HStack {
                    Text("Latest rates")
                    Spacer()
                    Text(Self.latest(answer)).foregroundStyle(PennyColor.secondaryLabel)
                        .pennyCrossfade(answer?.latestDate, duration: .quick)
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("currencySettings.latestRates")
            } else {
                HStack {
                    Text("Your last rates").layoutPriority(1)
                    Spacer()
                    Text(Self.lastRates(usage)).foregroundStyle(PennyColor.secondaryLabel)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("currencySettings.lastRates")
            }
        } header: {
            Text("Exchange rates").cardSectionHeader()
        } footer: {
            Text(on ? Self.ratesOnFooter : Self.ratesOffFooter)
        }
    }

    static let ratesOnFooter =
        "Each entry in another currency is converted at the rate for its date, and keeps it: later rates never change old totals. On weekends and holidays, the last business day's rate is used. Your server fetches the rates; turning them off is up to whoever runs it."
    static let ratesOffFooter =
        "Your server doesn't fetch exchange rates. When you add an entry in another currency, enter the rate you got; Penny suggests the last one you used for that currency."

    /// "Insights, Left to spend, budgets and recaps add up in Canadian dollars. Your home currency
    /// is locked once your ledger has entries."
    static func lockedFooter(_ home: Currency) -> String {
        let name =
            switch home {
            case .cad: "Canadian dollars"
            case .usd: "US dollars"
            case .eur: "euros"
            case .gbp: "pounds sterling"
            }
        return
            "Insights, Left to spend, budgets and recaps add up in \(name). Your home currency is locked once your ledger has entries."
    }

    /// "Fri, Nov 6", or a dash before the server has answered.
    static func latest(_ answer: WireExchangeRates?) -> String {
        guard let date = answer?.latestDate.flatMap(CalendarDate.init) else { return "—" }
        return CurrencyText.mediumDay(date)
    }

    /// "EUR 1.4600 · USD 1.3700": the last rate used for the two most recent currencies.
    static func lastRates(_ usage: CurrencyUsage) -> String {
        let rates = usage.uses.prefix(2).map { "\($0.code) \(CurrencyText.rate($0.lastRate))" }
        return rates.isEmpty ? "None yet" : rates.joined(separator: " · ")
    }

    private func option(_ currency: Currency, ledger: Ledger) -> some View {
        let selected = ledger.currency == currency
        return Button {
            choose(currency)
        } label: {
            HStack(spacing: 12) {
                Text(currency.rawValue).font(.body.weight(.bold)).frame(width: 54, alignment: .leading)
                Text(Currencies.info(currency.rawValue)?.name ?? "")
                Spacer()
                if selected {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(PennyColor.tint)
                }
            }
            .foregroundStyle(PennyColor.label)
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("currency.\(currency.rawValue)")
    }

    /// The card's footer while the ledger rule locks the currency, the same sentence as Settings'
    /// Preferences footnote; any other reason (a household) as the rule gives it.
    static func footer(_ lockReason: String?) -> String? {
        lockReason == LedgerRuleError.currencyLocked.message ? CurrencyPolicy.settingsFootnote : lockReason
    }

    private func choose(_ currency: Currency) {
        guard shell.workspace.load.ledger?.currency != currency else { return }
        saving = currency
        Task {
            failure = await shell.commit(
                .changeCurrency(currency), summary: ChangeSummary(title: "Currency updated", detail: currency.rawValue))
            if failure == nil { saving = nil }
        }
    }
}

/// The lock settings (`app-lock` card). Turning it on asks for biometrics first; while it is on,
/// Lock after (MAZ-133) chooses how long Penny can stay in the background before it locks. Both
/// settings stay on this device. Widgets and notification previews are outside the lock.
struct AppLockSettingsView: View {
    @Environment(AppLockController.self) private var lock

    var body: some View {
        let name = lock.biometry == .none ? "Face ID" : lock.biometry.name
        let title = SettingsView.lockTitle(lock.biometry)
        List {
            // The card's header: a copper lock on a tile, the title and what the lock does, centered
            // under an empty navigation bar.
            Section {
                VStack(spacing: 4) {
                    Image(systemName: "lock.fill")
                        .font(.largeTitle)
                        .foregroundStyle(PennyColor.tint)
                        .frame(width: 72, height: 72)
                        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .padding(.bottom, 8)
                        .accessibilityHidden(true)
                    Text(title).font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text("Ask for \(name) when Penny opens or comes back from the background.")
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 14)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("appLock.header")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            Section {
                Toggle(
                    "Require \(name)",
                    isOn: Binding(get: { lock.isEnabled }, set: { next in Task { await lock.setEnabled(next) } })
                )
                .tint(PennyColor.tint)
                .disabled(lock.isBusy)
                .frame(minHeight: Metrics.minTouchTarget)
                .listRowInsets(Self.rowInsets)
                .accessibilityIdentifier("appLock.toggle")
                if let message = lock.message {
                    Text(message).font(.footnote).foregroundStyle(PennyColor.danger)
                        .accessibilityIdentifier("appLock.message")
                }
            } footer: {
                if !lock.isEnabled { footer }
            }
            if lock.isEnabled {
                Section {
                    ForEach(AppLockDelay.allCases, id: \.self) { option in
                        Button {
                            lock.setDelay(option)
                        } label: {
                            HStack {
                                Text(option.title).foregroundStyle(PennyColor.label)
                                Spacer()
                                if lock.delay == option {
                                    Image(systemName: "checkmark").foregroundStyle(PennyColor.tint)
                                }
                            }
                            .frame(minHeight: Metrics.minTouchTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(lock.isBusy)
                        .accessibilityAddTraits(lock.delay == option ? .isSelected : [])
                        .listRowInsets(Self.rowInsets)
                        .accessibilityIdentifier("appLock.delay.\(option.rawValue)")
                    }
                } header: {
                    Text("Lock after").cardSectionHeader()
                } footer: {
                    footer
                }
            }
        }
        .insetGroupedList()
        // The header sits right under the empty bar, as on the card.
        .contentMargins(.top, 4, for: .scrollContent)
        .background(PennyColor.background)
        .navigationTitle(title)
        .toolbarTitleDisplayModeInline()
        // The header names the page, so the bar stays empty, as on the card.
        .toolbar(removing: .title)
        .accessibilityIdentifier("screen.appLock")
    }

    /// The card's 50-point rows: a 44-point touch target with 3 points above and below.
    private static let rowInsets = EdgeInsets(top: 3, leading: 16, bottom: 3, trailing: 16)

    /// Under the last section: the passcode fallback, where the setting lives, and what the
    /// lock doesn't cover.
    private var footer: some View {
        Text(
            "Your \(SyncBanner.deviceName) passcode works as a backup. This setting stays on this \(SyncBanner.deviceName) and isn't synced. "
                + "Widgets and notification previews aren't covered by the lock.")
    }
}
