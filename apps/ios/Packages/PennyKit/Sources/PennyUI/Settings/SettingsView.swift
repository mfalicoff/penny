import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Settings (`settings` card): the account and its sync status, which opens the server's details;
/// Manage (Recurring, Accounts, Categories: the old More tab, iPhone only, as on iPad they are in
/// the sidebar); Preferences (Appearance, Currency, the lock); the read-only server; and Sign out,
/// or Leave demo. A sheet from Home on iPhone, the detail column on iPad.
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
        let currencyLocked = ledger.map { CurrencyPolicy.lockReason(ledger: $0) != nil } ?? false
        List {
            Section {
                // The account opens its details (server, email, status); the demo has none.
                if shell.account != nil {
                    pageLink(.server) { _ in AccountHeader() }
                        .accessibilityIdentifier("settings.account")
                } else {
                    AccountHeader()
                }
            }
            // On iPad, Manage is in the sidebar (`ipad-settings`), so the list leaves it out.
            if !shell.route.settingsIsColumn {
                CardSection("Manage") {
                    row(.recurring, symbol: "repeat", value: ledger.map { "\($0.recurring.count)" })
                    row(.accounts, symbol: "wallet.bifold", value: ledger.map { "\($0.accounts.count)" })
                    row(.categories, symbol: "tag", value: ledger.map { "\($0.categories.count)" })
                }
            }
            Section {
                row(.appearance, symbol: "sun.max", value: appearance.preference.title)
                // Locked: the value and a lock, with no chevron (the page still shows the choices).
                row(.currency, symbol: "banknote", value: ledger?.currency.rawValue, locked: currencyLocked)
                row(
                    .appLock, symbol: "lock", value: lock.isEnabled ? "On" : "Off", title: Self.lockTitle(lock.biometry)
                )
            } header: {
                Text("Preferences").cardSectionHeader()
            } footer: {
                // The iPad card has no footnote here (the web's tablet layout leaves it out too).
                if currencyLocked, !shell.route.settingsIsColumn { Text(CurrencyPolicy.settingsFootnote) }
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
                            }
                            .disabled(!shell.receiptInbox.isAvailable)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(ReceiptInboxRules.spokenCount(count))
                            .accessibilityAddTraits(.isButton)
                            .accessibilityIdentifier("settings.receiptInbox")
                        }
                    } header: {
                        Text("Emailed receipts").cardSectionHeader()
                    } footer: {
                        if !shell.receiptInbox.isAvailable { Text(InboxText.offline) }
                    }
                }
                if let push {
                    // MAZ-79: household notifications, for an account only.
                    Section {
                        NotificationSettingsRow(push: push).cardSettingsRow()
                    } footer: {
                        Text(NotificationText.footer(permission: push.permission, status: push.registrar.status))
                    }
                }
                Section {
                    // Read-only, as on the card: the host, why it can't change, and a lock. The
                    // account row above opens the server's details.
                    HStack {
                        Label {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ServerText.host(account.server)).lineLimit(1)
                                Text("Sign out to change servers").font(.footnote)
                                    .foregroundStyle(PennyColor.secondaryLabel)
                            }
                        } icon: {
                            Image(systemName: "server.rack")
                        }
                        Spacer()
                        Self.lockMark(false)
                    }
                    .cardSettingsRow()
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("settings.server")
                } header: {
                    Text("Server").cardSectionHeader()
                }
                if let auth = shell.auth { Section { SignOutButton(auth: auth) } }
            } else if let leave = shell.leaveDemo {
                Section {
                    Button(role: .destructive, action: leave) {
                        Text("Leave demo").fontWeight(.medium).frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("settings.leaveDemo")
                } footer: {
                    Text("Everything you changed in the demo is discarded.")
                }
            }
        }
        .labelStyle(.settingsRow)
        .insetGroupedList()
        // The card's tighter gaps between groups, so the iPhone sheet fits on one screen.
        .settingsGroupSpacing()
        // The account sits right under the bar, as on the card (a list leaves a header-sized gap).
        .contentMargins(.top, 8, for: .scrollContent)
        .background(PennyColor.background)
        .navigationTitle("Settings")
        .modifier(SheetTitle(isSheet: onDone != nil))
        .task { await shell.receiptInbox.refresh() }
        .toolbar {
            if let onDone {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark", action: onDone)
                        .accessibilityIdentifier("settings.done")
                }
            }
        }
        .pennySolidBars()
        .accessibilityIdentifier("screen.settings")
    }

    static func lockTitle(_ biometry: BiometryKind) -> String {
        biometry == .none ? "App lock" : "\(biometry.name) lock"
    }

    /// A row that opens its page. A locked one shows its value and a lock instead of the chevron.
    private func row(
        _ route: SettingsRoute, symbol: String, value: String?, locked: Bool = false, title: String? = nil
    ) -> some View {
        pageLink(route, chevron: !locked) { selected in
            HStack {
                Label(title ?? route.title, systemImage: symbol)
                Spacer()
                if let value { Text(value).foregroundStyle(Self.valueStyle(selected)) }
                if locked { Self.lockMark(selected) }
            }
        }
        .accessibilityIdentifier("settings.\(route.rawValue)")
    }

    static func valueStyle(_ selected: Bool) -> Color {
        selected ? Color.white.opacity(0.85) : PennyColor.secondaryLabel
    }

    /// The cards' small lock where a row's value can't change (Currency, Server).
    static func lockMark(_ selected: Bool) -> some View {
        Image(systemName: "lock.fill").font(.footnote).foregroundStyle(valueStyle(selected))
            .accessibilityLabel("Locked")
    }

    /// A row that opens a Settings page: pushed onto the stack, or, on iPad with the page beside
    /// the list (`ipad-settings`, MAZ-182), selected there (a copper row with white text).
    /// `chevron` false leaves out the chevron (a locked row), which a navigation link always
    /// draws, so that row pushes onto the Settings path itself.
    @ViewBuilder
    private func pageLink<Content: View>(
        _ route: SettingsRoute, chevron: Bool = true, @ViewBuilder label: (Bool) -> Content
    ) -> some View {
        if let select {
            let selected = selection == route
            Button {
                select(route)
            } label: {
                HStack {
                    label(selected)
                    if chevron { Self.chevron(selected) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(selected ? Color.white : PennyColor.label)
            .tint(selected ? Color.white : PennyColor.tint)
            .listRowBackground(selected ? PennyColor.tint : PennyColor.surface)
            .cardSettingsRow()
            .environment(\.settingsRowSelected, selected)
            .accessibilityAddTraits(selected ? .isSelected : [])
        } else if chevron {
            NavigationLink(value: route) { label(false) }.cardSettingsRow()
        } else {
            Button {
                shell.route.settingsPath.append(route)
            } label: {
                label(false).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(PennyColor.label)
            .cardSettingsRow()
        }
    }

    private static func chevron(_ selected: Bool) -> some View {
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
            .foregroundStyle(selected ? Color.white.opacity(0.85) : PennyColor.tertiaryLabel)
            .accessibilityHidden(true)
    }
}

/// The account (or demo) with its sync status: a monogram, the account and, when synced, a
/// green cloud (`settings` card).
private struct AccountHeader: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.settingsRowSelected) private var selected

    var body: some View {
        let sync = shell.workspace.sync
        HStack(spacing: 14) {
            Monogram(initials: shell.account.map { HouseholdPeople.initials(email: $0.email) } ?? "D", size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(shell.account?.email ?? "Demo account").font(.title3.weight(.bold)).lineLimit(1)
                HStack(spacing: 5) {
                    Image(systemName: SyncText.symbol(sync))
                        .foregroundStyle(Self.symbolStyle(sync, selected: selected))
                        .accessibilityHidden(true)
                    Text(SyncText.line(sync))
                }
                .font(.subheadline)
                .foregroundStyle(
                    selected
                        ? Color.white.opacity(0.85)
                        : sync.needsAttention ? PennyColor.pending : PennyColor.secondaryLabel
                )
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("settings.syncStatus")
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    /// Green once synced, as on the card; amber when something needs attention.
    static func symbolStyle(_ sync: SyncStatus, selected: Bool) -> Color {
        if selected { return Color.white }
        if sync.needsAttention { return PennyColor.pending }
        if case .upToDate = sync { return PennyColor.income }
        return PennyColor.secondaryLabel
    }
}

/// The page for a Settings route.
struct SettingsPage: View {
    let route: SettingsRoute

    var body: some View {
        page.pennySolidBars()
    }

    @ViewBuilder private var page: some View {
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

    /// Under Preferences in Settings while the currency is locked, the same sentence on iOS and the
    /// web (MAZ-250): the apps lock it once the ledger has entries or schedules.
    static let settingsFootnote = "Currency is locked once your ledger has entries."

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

/// A Settings row's icon as the cards draw it (`.si`): a label-color glyph in a neutral 30pt
/// tile, white on a translucent tile in the selected iPad row. Copper stays for actions.
struct SettingsRowLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 12) {
            SettingsIconTile { configuration.icon }
            configuration.title
        }
    }
}

private struct SettingsIconTile<Icon: View>: View {
    @Environment(\.settingsRowSelected) private var selected
    @ScaledMetric(relativeTo: .body) private var size = 30
    @ViewBuilder let icon: Icon

    var body: some View {
        icon
            .font(.callout)
            .foregroundStyle(selected ? Color.white : PennyColor.label)
            .frame(width: size, height: size)
            .background(
                selected ? Color.white.opacity(0.22) : PennyColor.fill,
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

extension EnvironmentValues {
    /// Set on the selected Settings row beside the iPad's page, so its icon tile turns white.
    @Entry var settingsRowSelected = false
}

extension LabelStyle where Self == SettingsRowLabelStyle {
    static var settingsRow: SettingsRowLabelStyle { SettingsRowLabelStyle() }
}

/// The iPhone sheet's centered inline title (`settings` card); the iPad column keeps its large
/// title, as `ipad-settings` shows.
private struct SheetTitle: ViewModifier {
    let isSheet: Bool

    func body(content: Content) -> some View {
        if isSheet { content.toolbarTitleDisplayModeInline() } else { content }
    }
}

extension View {
    /// The list's compact gaps between sections (iOS only; the host tests build for macOS).
    fileprivate func settingsGroupSpacing() -> some View {
        #if os(iOS)
            listSectionSpacing(.compact)
        #else
            self
        #endif
    }
}
