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
    case trip(id: String)
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
/// - Add entry opens over whatever is shown, and only Settings is closed for it.
public struct ShellRoute: Equatable, Sendable {
    public private(set) var tab: AppTab
    public private(set) var paths: [AppTab: [DetailRoute]]
    public var isSettingsPresented: Bool
    public var settingsPath: [SettingsRoute]
    public var isAddEntryPresented: Bool

    public init(tab: AppTab = .home) {
        self.tab = tab
        paths = [:]
        isSettingsPresented = false
        settingsPath = []
        isAddEntryPresented = false
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
        isSettingsPresented = true
        settingsPath = page.map { [$0] } ?? []
    }

    public mutating func openAddEntry() {
        isSettingsPresented = false
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
        case .authCallback: break
        }
    }

    private mutating func show(_ next: AppTab, _ path: [DetailRoute]) {
        isSettingsPresented = false
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

/// Holds a deep link until the shell can show it: after sign-in finishes and the app lock is
/// open. A link that arrives while signed out or locked is kept, not dropped and not shown
/// behind the lock; a newer link replaces an older one.
public struct DeepLinkInbox: Equatable, Sendable {
    public private(set) var pending: DeepLink?

    public init(_ pending: DeepLink? = nil) { self.pending = pending }

    /// Keeps `link` for later. The OIDC callback is not a destination and is ignored.
    public mutating func receive(_ link: DeepLink) {
        if case .authCallback = link { return }
        pending = link
    }

    /// The pending link, once, when the shell is ready for it.
    public mutating func take(ready: Bool) -> DeepLink? {
        guard ready, let link = pending else { return nil }
        pending = nil
        return link
    }
}
