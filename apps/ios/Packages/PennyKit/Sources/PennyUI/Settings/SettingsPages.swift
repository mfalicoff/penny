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
                    Text("Penny supports Dynamic Type. Change text size in \(SyncBanner.deviceName) Settings › Display & Brightness.")
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
                    .frame(maxWidth: typeSize.isAccessibilitySize ? 120 : .infinity)
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

/// A small phone drawn in one appearance: the glow, a title bar and three cards. System shows
/// light and dark halves.
private struct ThemePreview: View {
    let option: AppearancePreference

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        Group {
            switch option {
            case .light: screen.environment(\.colorScheme, .light)
            case .dark: screen.environment(\.colorScheme, .dark)
            case .system:
                screen.environment(\.colorScheme, .light)
                    .overlay {
                        screen.environment(\.colorScheme, .dark)
                            .mask(alignment: .trailing) {
                                GeometryReader { proxy in
                                    Rectangle().frame(width: proxy.size.width / 2)
                                        .frame(maxWidth: .infinity, alignment: .trailing)
                                }
                            }
                    }
            }
        }
        .aspectRatio(0.54, contentMode: .fit)
        .clipShape(shape)
        .overlay(shape.strokeBorder(PennyColor.separator, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var screen: some View {
        VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(PennyColor.label).frame(width: 44, height: 10)
            Capsule().fill(PennyColor.tertiaryLabel).frame(width: 30, height: 4)
            Spacer().frame(height: 10)
            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(PennyColor.surface).frame(height: 30)
            }
            Spacer(minLength: 0)
            Capsule().fill(PennyColor.surface.opacity(0.7)).frame(height: 12)
        }
        .padding(10)
        .padding(.top, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(alignment: .top) {
            HeroGlow(blur: 10).frame(height: 70).padding(.horizontal, -20).offset(y: -20)
        }
        .background(PennyColor.background)
    }
}

/// Currency (`settings` card's Currency row): the four currencies the API accepts, locked
/// with the reason once entries exist (or, from MAZ-75, while in a household).
struct CurrencySettingsView: View {
    @Environment(ShellModel.self) private var shell
    @State private var failure: SaveFailure?
    @State private var saving: Currency?

    var body: some View {
        WorkspaceContent { ledger in
            let lockReason = CurrencyPolicy.lockReason(ledger: ledger)
            List {
                if let failure {
                    Section {
                        SaveErrorBanner(failure: failure, retry: saving.map { currency in { choose(currency) } })
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                }
                Section {
                    ForEach(CurrencyPolicy.options, id: \.self) { currency in
                        let selected = ledger.currency == currency
                        Button {
                            choose(currency)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(currency.rawValue).font(.body.weight(.semibold))
                                    Text(Self.name(currency)).font(.footnote)
                                        .foregroundStyle(PennyColor.secondaryLabel)
                                }
                                Spacer()
                                if selected { Image(systemName: "checkmark").foregroundStyle(PennyColor.tint) }
                            }
                            .frame(minHeight: Metrics.minTouchTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(lockReason != nil && !selected)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .accessibilityIdentifier("currency.\(currency.rawValue)")
                    }
                } footer: {
                    Text(
                        lockReason
                            ?? "Choose your currency before adding entries. One currency per account keeps your totals consistent."
                    )
                }
            }
            .insetGroupedList()
        }
        .background(PennyColor.background)
        .navigationTitle("Currency")
        .accessibilityIdentifier("screen.currency")
    }

    static func name(_ currency: Currency) -> String {
        Locale.current.localizedString(forCurrencyCode: currency.rawValue) ?? currency.rawValue
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
