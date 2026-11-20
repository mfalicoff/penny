import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Settings (`settings` card): the account and its sync status; Manage (Recurring, Accounts,
/// Categories: the old More tab); Preferences (Appearance, Currency, the lock); the read-only
/// server; and Sign out, or Leave demo. A sheet from Home on iPhone, the detail column on iPad.
struct SettingsView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(AppearanceModel.self) private var appearance
    @Environment(AppLockController.self) private var lock
    @Environment(PushNotifications.self) private var push: PushNotifications?
    /// Shown on iPhone, where Settings is a sheet.
    var onDone: (() -> Void)?
    /// The page shown beside the list on iPad (`SettingsColumns`); nil when rows push pages.
    var selection: SettingsRoute?
    /// Set when the page shows beside the list: a row selects its page instead of pushing it.
    var select: ((SettingsRoute) -> Void)?

    var body: some View {
        let ledger = shell.workspace.load.ledger
        List {
            Section {
                AccountHeader()
            }
            Section("Manage") {
                manageRow(.recurring, symbol: "repeat", value: ledger.map { "\($0.recurring.count)" })
                manageRow(.accounts, symbol: "wallet.bifold", value: ledger.map { "\($0.accounts.count)" })
                manageRow(.categories, symbol: "tag", value: ledger.map { "\($0.categories.count)" })
            }
            Section {
                row(.appearance, symbol: "sun.max", value: appearance.preference.title)
                row(
                    .currency, symbol: "banknote", value: ledger?.currency.rawValue,
                    locked: ledger.map { CurrencyPolicy.lockReason(ledger: $0) != nil } ?? false)
                row(
                    .appLock, symbol: "lock", value: lock.isEnabled ? "On" : "Off", title: Self.lockTitle(lock.biometry)
                )
            } header: {
                Text("Preferences")
            } footer: {
                if let ledger, let reason = CurrencyPolicy.lockReason(ledger: ledger) { Text(reason) }
            }
            if let account = shell.account {
                // MAZ-184: emailed receipts, only when the server takes them.
                if shell.receiptInbox.isEnabled {
                    Section {
                        row(
                            .receiptEmail, symbol: "envelope",
                            value: shell.receiptInbox.address == nil ? "Off" : "On")
                        if shell.receiptInbox.address != nil || shell.receiptInbox.toAttachCount > 0 {
                            let count = shell.receiptInbox.toAttachCount
                            pageLink(.receiptInbox) { selected in
                                HStack {
                                    Label(SettingsRoute.receiptInbox.title, systemImage: "tray.and.arrow.down")
                                    Spacer()
                                    if count > 0 {
                                        Text(shell.receiptInbox.hasMoreToAttach ? "\(count)+" : "\(count)")
                                            .monospacedDigit()
                                            .foregroundStyle(Self.valueStyle(selected))
                                    }
                                }
                                .frame(minHeight: Metrics.minTouchTarget)
                            }
                            .disabled(!shell.receiptInbox.isAvailable)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(ReceiptInboxRules.spokenCount(count))
                            .accessibilityAddTraits(.isButton)
                            .accessibilityIdentifier("settings.receiptInbox")
                        }
                    } header: {
                        Text("Emailed receipts")
                    } footer: {
                        if !shell.receiptInbox.isAvailable { Text(InboxText.offline) }
                    }
                }
                if let push {
                    // MAZ-79: household notifications, for an account only.
                    Section {
                        NotificationSettingsRow(push: push)
                    } footer: {
                        Text(NotificationText.footer(permission: push.permission, status: push.registrar.status))
                    }
                }
                Section {
                    pageLink(.server) { _ in
                        Label {
                            Text(ServerText.host(account.server))
                        } icon: {
                            Image(systemName: "server.rack")
                        }
                    }
                    .accessibilityIdentifier("settings.server")
                } header: {
                    Text("Server")
                } footer: {
                    Text("Sign out to change servers.")
                }
                if let auth = shell.auth { Section { SignOutButton(auth: auth) } }
            } else if let leave = shell.leaveDemo {
                Section {
                    Button("Leave demo", role: .destructive, action: leave)
                        .accessibilityIdentifier("settings.leaveDemo")
                } footer: {
                    Text("Everything you changed in the demo is discarded.")
                }
            }
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle("Settings")
        .task { await shell.receiptInbox.refresh() }
        .toolbar {
            if let onDone {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark", action: onDone)
                        .accessibilityIdentifier("settings.done")
                }
            }
        }
        .accessibilityIdentifier("screen.settings")
    }

    static func lockTitle(_ biometry: BiometryKind) -> String {
        biometry == .none ? "App lock" : "\(biometry.name) lock"
    }

    /// A Manage page. On iPad, where Settings is the detail column and these pages are sidebar
    /// rows of their own, the row selects the sidebar item instead of pushing onto the bound
    /// Settings path: a push there made the column swap stacks in the same update, and SwiftUI
    /// crashed (`NavigationColumnState.boundPathChange`, found by MAZ-82's iPad journeys).
    @ViewBuilder
    private func manageRow(_ route: SettingsRoute, symbol: String, value: String?) -> some View {
        if shell.route.settingsIsColumn {
            Button {
                shell.route.sidebarSelection = .manage(route)
            } label: {
                HStack {
                    Label(route.title, systemImage: symbol)
                    Spacer()
                    if let value { Text(value).foregroundStyle(PennyColor.secondaryLabel) }
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tertiaryLabel).accessibilityHidden(true)
                }
                .frame(minHeight: Metrics.minTouchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.\(route.rawValue)")
        } else {
            row(route, symbol: symbol, value: value)
        }
    }

    private func row(
        _ route: SettingsRoute, symbol: String, value: String?, locked: Bool = false, title: String? = nil
    ) -> some View {
        pageLink(route) { selected in
            HStack {
                Label(title ?? route.title, systemImage: symbol)
                Spacer()
                if let value { Text(value).foregroundStyle(Self.valueStyle(selected)) }
                if locked {
                    Image(systemName: "lock.fill").font(.footnote).foregroundStyle(Self.valueStyle(selected))
                        .accessibilityLabel("Locked")
                }
            }
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .accessibilityIdentifier("settings.\(route.rawValue)")
    }

    static func valueStyle(_ selected: Bool) -> Color {
        selected ? Color.white.opacity(0.85) : PennyColor.secondaryLabel
    }

    /// A row that opens a Settings page: pushed onto the stack, or, on iPad with the page beside
    /// the list (`ipad-settings`, MAZ-182), selected there (a copper row with white text).
    @ViewBuilder
    private func pageLink<Content: View>(_ route: SettingsRoute, @ViewBuilder label: (Bool) -> Content) -> some View {
        if let select {
            let selected = selection == route
            Button {
                select(route)
            } label: {
                HStack {
                    label(selected)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                        .foregroundStyle(selected ? Color.white.opacity(0.85) : PennyColor.tertiaryLabel)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(selected ? Color.white : PennyColor.label)
            .tint(selected ? Color.white : PennyColor.tint)
            .listRowBackground(selected ? PennyColor.tint : PennyColor.surface)
            .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            NavigationLink(value: route) { label(false) }
        }
    }
}

/// The account (or demo) with its sync status.
private struct AccountHeader: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        HStack(spacing: 12) {
            Text(Self.monogram(shell.account?.email))
                .font(.headline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 48, height: 48)
                .background(PennyColor.fill, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(shell.account?.email ?? "Demo account").font(.headline).lineLimit(1)
                Label(SyncText.line(shell.workspace.sync), systemImage: SyncText.symbol(shell.workspace.sync))
                    .font(.footnote)
                    .foregroundStyle(
                        shell.workspace.sync.needsAttention ? PennyColor.pending : PennyColor.secondaryLabel
                    )
                    .accessibilityIdentifier("settings.syncStatus")
            }
        }
        .accessibilityElement(children: .combine)
    }

    static func monogram(_ email: String?) -> String {
        guard let first = email?.first else { return "D" }
        return String(first).uppercased()
    }
}

/// The page for a Settings route.
struct SettingsPage: View {
    let route: SettingsRoute

    var body: some View {
        switch route {
        case .recurring: RecurringListView()
        case .accounts: AccountsListView()
        case .categories: CategoriesListView()
        case .appearance: AppearanceSettingsView()
        case .currency: CurrencySettingsView()
        case .appLock: AppLockSettingsView()
        case .server: ServerPage()
        case .receiptEmail: ReceiptEmailSettingsView()
        case .receiptInbox: ReceiptInboxView()
        }
    }
}

private struct ServerPage: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        if let account = shell.account {
            ServerInfoView(account: account, server: shell.auth?.server)
        } else {
            PennyStateView(.unavailable, title: "No server in the demo", message: "The demo never contacts a server.")
                .navigationTitle("Server")
        }
    }
}

/// When the ledger currency can't change, and why (the same checks as the API).
enum CurrencyPolicy {
    /// The currencies the API accepts (contracts/openapi.json `Ledger.currency`).
    static let options = Currency.allCases

    /// The server refuses a ledger currency that differs from an active household's
    /// (`Your ledger currency must match your active households.`), and the ledger rule
    /// refuses any change once there are entries or rules. Households arrive with MAZ-75, which
    /// passes the active count; until then only the ledger rule applies on the device.
    static func lockReason(ledger: Ledger, activeHouseholds: Int = 0) -> String? {
        if !ledger.transactions.isEmpty || !ledger.recurring.isEmpty { return LedgerRuleError.currencyLocked.message }
        if activeHouseholds > 0 { return "Currency is locked while you're in a household." }
        return nil
    }
}
