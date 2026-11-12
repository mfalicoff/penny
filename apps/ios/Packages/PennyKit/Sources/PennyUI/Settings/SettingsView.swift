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

    var body: some View {
        let ledger = shell.workspace.load.ledger
        List {
            Section {
                AccountHeader()
            }
            if let notice = shell.expoImport {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(notice.title).font(.body.weight(.semibold))
                            Text(notice.message).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                        }
                    } icon: {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(PennyColor.tint)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("settings.expoImport")
                }
            }
            Section("Manage") {
                row(.recurring, symbol: "repeat", value: ledger.map { "\($0.recurring.count)" })
                row(.accounts, symbol: "wallet.bifold", value: ledger.map { "\($0.accounts.count)" })
                row(.categories, symbol: "tag", value: ledger.map { "\($0.categories.count)" })
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
                if let push {
                    // MAZ-79: household notifications, for an account only.
                    Section {
                        NotificationSettingsRow(push: push)
                    } footer: {
                        Text(NotificationText.footer(permission: push.permission, status: push.registrar.status))
                    }
                }
                Section {
                    NavigationLink(value: SettingsRoute.server) {
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

    private func row(
        _ route: SettingsRoute, symbol: String, value: String?, locked: Bool = false, title: String? = nil
    ) -> some View {
        NavigationLink(value: route) {
            HStack {
                Label(title ?? route.title, systemImage: symbol)
                Spacer()
                if let value { Text(value).foregroundStyle(PennyColor.secondaryLabel) }
                if locked {
                    Image(systemName: "lock.fill").font(.footnote).foregroundStyle(PennyColor.tertiaryLabel)
                        .accessibilityLabel("Locked")
                }
            }
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .accessibilityIdentifier("settings.\(route.rawValue)")
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
