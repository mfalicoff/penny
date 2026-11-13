import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Appearance (`appearance` card): Light, Dark or System; text size follows the device.
struct AppearanceSettingsView: View {
    @Environment(AppearanceModel.self) private var appearance

    var body: some View {
        List {
            Section {
                ForEach(AppearancePreference.allCases, id: \.self) { option in
                    Button {
                        appearance.set(option)
                    } label: {
                        HStack {
                            Text(option.title).foregroundStyle(PennyColor.label)
                            Spacer()
                            if appearance.preference == option {
                                Image(systemName: "checkmark").foregroundStyle(PennyColor.tint)
                            }
                        }
                        .frame(minHeight: Metrics.minTouchTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(appearance.preference == option ? .isSelected : [])
                    .accessibilityIdentifier("appearance.\(option.rawValue)")
                }
            } header: {
                Text("Theme")
            } footer: {
                Text(
                    "System follows your device's Light and Dark setting, including scheduled switching. "
                        + "Dark mode uses true black. This setting stays on this device.")
            }
            Section {
                LabeledContent("Text size", value: "Follows your device")
            } header: {
                Text("Text")
            } footer: {
                Text("Penny supports Dynamic Type. Change text size in Settings › Display & Brightness.")
            }
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle("Appearance")
        .accessibilityIdentifier("screen.appearance")
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

/// The lock settings (`app-lock` card). Turning it on asks for biometrics first; the setting
/// stays on this device. Widgets and notification previews are outside the lock.
struct AppLockSettingsView: View {
    @Environment(AppLockController.self) private var lock

    var body: some View {
        let name = lock.biometry == .none ? "Face ID" : lock.biometry.name
        List {
            Section {
                Toggle(
                    "Require \(name)",
                    isOn: Binding(get: { lock.isEnabled }, set: { next in Task { await lock.setEnabled(next) } })
                )
                .tint(PennyColor.tint)
                .disabled(lock.isBusy)
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityIdentifier("appLock.toggle")
                if let message = lock.message {
                    Text(message).font(.footnote).foregroundStyle(PennyColor.danger)
                        .accessibilityIdentifier("appLock.message")
                }
            } header: {
                Text("Ask for \(name) when Penny opens or comes back from the background.")
                    .textCase(nil)
            } footer: {
                Text(
                    "Your device passcode works as a backup. This setting stays on this device and isn't synced. "
                        + "Widgets and notification previews aren't covered by the lock.")
            }
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle(SettingsView.lockTitle(lock.biometry))
        .accessibilityIdentifier("screen.appLock")
    }
}
