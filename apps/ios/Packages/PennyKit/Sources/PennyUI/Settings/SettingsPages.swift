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

/// Recurring schedules: cadence, next date and amount. Pause, edit and remove arrive with MAZ-74.
struct RecurringListView: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        WorkspaceContent { ledger in
            List {
                ForEach(ledger.recurring, id: \.id) { rule in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rule.title).font(.body.weight(.semibold))
                            Text(Self.cadence(rule, today: shell.today))
                                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        }
                        Spacer(minLength: 8)
                        MoneyText(
                            rule.share, meaning: rule.active ? .pending : .neutral,
                            currency: ledger.currency.rawValue)
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityElement(children: .combine)
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.recurring.isEmpty {
                    PennyStateView(
                        .empty, title: "No recurring entries",
                        message: "Pay, rent and subscriptions you repeat show up here with their next date.")
                }
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Recurring")
        .accessibilityIdentifier("screen.recurring")
    }

    static func cadence(_ rule: RecurringRule, today: CalendarDate) -> String {
        let every =
            switch rule.frequency {
            case .weekly: "Weekly"
            case .monthly: "Monthly"
            case .yearly: "Yearly"
            }
        guard rule.active else { return "\(every) · Paused" }
        return "\(every) · Next \(DayText.short(rule.nextDate, today: today))"
    }
}

/// Accounts are labels with usage counts, never balances. Editing arrives with MAZ-74.
struct AccountsListView: View {
    var body: some View {
        WorkspaceContent { ledger in
            List {
                ForEach(ledger.accounts, id: \.id) { account in
                    let uses = Self.uses(account.id, in: ledger)
                    HStack {
                        Label(account.name, systemImage: Self.symbol(account.type))
                        Spacer()
                        Text(uses == 1 ? "1 entry" : "\(uses) entries").foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityElement(children: .combine)
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.accounts.isEmpty {
                    PennyStateView(
                        .empty, title: "No accounts",
                        message: "Accounts are labels for what paid, like a card or a bank account. Penny never "
                            + "tracks balances.")
                }
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Accounts")
        .accessibilityIdentifier("screen.accounts")
    }

    static func uses(_ id: String, in ledger: Ledger) -> Int {
        ledger.transactions.count { $0.accountId == id } + ledger.recurring.count { $0.accountId == id }
    }

    static func symbol(_ type: AccountType) -> String {
        switch type {
        case .bank: "building.columns"
        case .credit: "creditcard"
        case .cash: "banknote"
        case .other: "wallet.bifold"
        }
    }
}

/// Categories by kind. Editing and the color picker arrive with MAZ-74.
struct CategoriesListView: View {
    var body: some View {
        WorkspaceContent { ledger in
            List {
                ForEach(EntryKind.allCases, id: \.self) { kind in
                    let categories = ledger.categories.filter { $0.kind == kind }
                    if !categories.isEmpty {
                        Section(Self.title(kind)) {
                            ForEach(categories, id: \.id) { category in
                                HStack(spacing: 12) {
                                    CategoryIcon(
                                        symbol: CategoryStyle.symbol(forIonicon: category.icon),
                                        color: PennyColor.category(CategoryStyle.color(forCategoryID: category.id)),
                                        size: 32)
                                    Text(category.name)
                                }
                                .frame(minHeight: Metrics.minTouchTarget)
                            }
                        }
                    }
                }
            }
            .insetGroupedList()
        }
        .background(PennyColor.background)
        .navigationTitle("Categories")
        .accessibilityIdentifier("screen.categories")
    }

    static func title(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "Expenses"
        case .income: "Income"
        case .investment: "Investments"
        }
    }
}
