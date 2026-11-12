/// The four root tabs (contracts/design-baseline.json `navigation.iPhone.tabs`). There is no
/// More tab: Recurring, Accounts, Categories and Settings open from Home's settings button.
public enum AppTab: String, CaseIterable, Hashable, Sendable {
    case home, activity, shared, trips

    public var title: String {
        switch self {
        case .home: "Home"
        case .activity: "Activity"
        case .shared: "Shared"
        case .trips: "Trips"
        }
    }
}

/// A page pushed on top of a tab's root (iPhone) or shown in the detail column (iPad).
public enum DetailRoute: Hashable, Sendable {
    case household(id: String)
    case householdExpense(householdID: String, expenseID: String)
    /// A household's change history (MAZ-75).
    case householdHistory(householdID: String)
    case trip(id: String)
    /// A personal entry's detail (Activity, MAZ-73).
    case entry(id: String)
    /// Home's analysis pages for the month on screen (MAZ-77): the money flow, Insights
    /// (spending by category), the calendar, and one category's entries. They follow the
    /// shell's month, so they are pages of the Home stack rather than deep-link destinations.
    case moneyFlow
    case insights
    case calendar
    case categorySpending(categoryIds: [String], title: String)
}

/// Pages inside Settings. The first three are the old More tab's "Manage" pages, which the
/// iPad sidebar lists directly.
public enum SettingsRoute: String, CaseIterable, Hashable, Sendable {
    case recurring, accounts, categories, appearance, currency, appLock, server

    public static let manage: [SettingsRoute] = [.recurring, .accounts, .categories]

    public var title: String {
        switch self {
        case .recurring: "Recurring"
        case .accounts: "Accounts"
        case .categories: "Categories"
        case .appearance: "Appearance"
        case .currency: "Currency"
        case .appLock: "Face ID lock"
        case .server: "Server"
        }
    }

    init(_ page: DeepLink.SettingsPage) {
        switch page {
        case .accounts: self = .accounts
        case .categories: self = .categories
        case .recurring: self = .recurring
        }
    }
}

/// What the iPad sidebar has selected.
public enum SidebarItem: Hashable, Sendable {
    case tab(AppTab)
    case manage(SettingsRoute)
    case settings
}

/// The whole navigation state of the signed-in shell, as a value so every rule here is
/// tested without a view. iPhone shows it as a tab bar with one stack per tab and sheets for
/// Settings and Add entry; iPad shows the same state as a sidebar and a detail column, so
/// rotating or resizing between the two keeps the place.
///
/// Rules (the redesign's "stable root, focused detail" behavior):
/// - Each tab keeps its own stack while another tab is shown.
/// - Choosing the tab already shown returns it to its root.
/// - A deep link shows its destination from that tab's root (so Back always leads to the
///   tab's root, never to an unrelated screen) and closes a sheet that would hide it.
/// - Add entry opens over whatever is shown. Only the Settings sheet (iPhone) is closed for
///   it: on iPad Settings is the detail column, which stays where it is (`settingsIsColumn`).
public struct ShellRoute: Equatable, Sendable {
    public private(set) var tab: AppTab
    public private(set) var paths: [AppTab: [DetailRoute]]
    public var isSettingsPresented: Bool
    public var settingsPath: [SettingsRoute]
    public var isAddEntryPresented: Bool
    /// The create-or-join household sheet (MAZ-75), over the Shared tab.
    public var householdStart: HouseholdStart?
    /// True while Settings is shown as the iPad split view's detail column rather than a sheet
    /// (the shell sets it from its layout). Add entry then opens over it and leaves it alone:
    /// closing it would swap the detail column's bound navigation stack for another in the
    /// same update as the sheet appears, which crashes SwiftUI
    /// (`NavigationColumnState.boundPathChange`, MAZ-78).
    public var settingsIsColumn = false

    public init(tab: AppTab = .home) {
        self.tab = tab
        paths = [:]
        isSettingsPresented = false
        settingsPath = []
        isAddEntryPresented = false
        householdStart = nil
    }

    public func path(for tab: AppTab) -> [DetailRoute] { paths[tab] ?? [] }

    public mutating func setPath(_ path: [DetailRoute], for tab: AppTab) { paths[tab] = path }

    /// The person chose a tab. Choosing the current one pops it to its root.
    public mutating func select(_ next: AppTab) {
        if next == tab { paths[next] = [] }
        tab = next
    }

    /// Shows a page inside the current tab.
    public mutating func push(_ route: DetailRoute) { paths[tab, default: []].append(route) }

    public mutating func openSettings(_ page: SettingsRoute? = nil) {
        isAddEntryPresented = false
        householdStart = nil
        isSettingsPresented = true
        settingsPath = page.map { [$0] } ?? []
    }

    public mutating func openAddEntry() {
        if !settingsIsColumn { isSettingsPresented = false }
        householdStart = nil
        isAddEntryPresented = true
    }

    /// Routes a `penny://` link. The OIDC callback is never a destination.
    public mutating func open(_ link: DeepLink) {
        switch link {
        case .home: show(.home, [])
        case .activity: show(.activity, [])
        case .addEntry: openAddEntry()
        case .settings(let page): openSettings(SettingsRoute(page))
        case .households: show(.shared, [])
        case .household(let id): show(.shared, [.household(id: id)])
        case .householdExpense(let household, let expense):
            show(.shared, [.household(id: household), .householdExpense(householdID: household, expenseID: expense)])
        case .trips: show(.trips, [])
        case .trip(let id): show(.trips, [.trip(id: id)])
        case .join(let code, let server):
            show(.shared, [])
            householdStart = .join(code: code, server: server)
        case .authCallback: break
        }
    }

    private mutating func show(_ next: AppTab, _ path: [DetailRoute]) {
        isSettingsPresented = false
        householdStart = nil
        settingsPath = []
        isAddEntryPresented = false
        tab = next
        paths[next] = path
    }

    /// The iPad sidebar's view of the same state. Recurring, Accounts and Categories are
    /// sidebar rows there; every other Settings page is under the Settings row.
    public var sidebarSelection: SidebarItem {
        get {
            guard isSettingsPresented else { return .tab(tab) }
            if let first = settingsPath.first, SettingsRoute.manage.contains(first) { return .manage(first) }
            return .settings
        }
        set {
            switch newValue {
            case .tab(let next):
                isSettingsPresented = false
                settingsPath = []
                select(next)
            case .manage(let page): openSettings(page)
            case .settings: openSettings()
            }
        }
    }
}

/// Who a shell shows, for `DeepLinkInbox`: an account (by a stable key, its scope) or the demo.
public enum DeepLinkSession: Hashable, Sendable {
    case account(String)
    case demo
}

/// Holds a deep link until the shell can show it: after sign-in finishes and the app lock is
/// open. A link that arrives while signed out or locked is kept, not dropped and not shown
/// behind the lock; a newer link replaces an older one.
///
/// A link belongs to the session showing when it arrived (`session`). One that arrived while
/// an account was signed in opens only in that account: another account's shell drops it, so
/// a link kept from before a sign-out never opens in the next account. The demo takes only
/// links that arrived during the demo and leaves the others waiting. A link that arrived while
/// no session was showing (signed out, or still restoring at launch) opens in the next account.
public struct DeepLinkInbox: Equatable, Sendable {
    public private(set) var pending: DeepLink?
    /// The session showing when `pending` arrived; nil when none was.
    public private(set) var owner: DeepLinkSession?
    /// The session showing now. The gate keeps it current (`sessionChanged(to:)`).
    public private(set) var session: DeepLinkSession?

    public init(_ pending: DeepLink? = nil, owner: DeepLinkSession? = nil) {
        self.pending = pending
        self.owner = owner
    }

    /// Keeps `link` for later, for the session showing now. The OIDC callback is not a
    /// destination and is ignored.
    public mutating func receive(_ link: DeepLink) {
        if case .authCallback = link { return }
        pending = link
        owner = session
    }

    /// Records the session now showing (nil while signed out or restoring).
    public mutating func sessionChanged(to session: DeepLinkSession?) {
        self.session = session
    }

    /// The pending link, once, when the shell showing `session` is ready for it and the link
    /// is for that session. A link for another account is dropped.
    public mutating func take(ready: Bool, for session: DeepLinkSession) -> DeepLink? {
        guard let link = pending else { return nil }
        switch (owner, session) {
        case (.account(let mine), .account(let theirs)) where mine != theirs:
            // For another account: never open it here.
            clear()
            return nil
        case (.demo, .account):
            // Left from the demo: never open it in an account.
            clear()
            return nil
        case (.account, .demo), (nil, .demo):
            // An account's link (or one from before any sign-in) waits for an account.
            return nil
        default:
            break
        }
        guard ready else { return nil }
        clear()
        return link
    }

    private mutating func clear() {
        pending = nil
        owner = nil
    }
}

/// What the create-or-join household sheet opens on (MAZ-75).
public enum HouseholdStart: Hashable, Identifiable, Sendable {
    case create
    /// Join, with the values of a `penny://join` link when one opened it (nil when typed).
    case join(code: String?, server: String?)

    public var id: String {
        switch self {
        case .create: "create"
        case .join(let code, let server): "join \(code ?? "") \(server ?? "")"
        }
    }
}
