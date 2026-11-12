import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The signed-in (or demo) shell. In a compact width (iPhone, iPad Slide Over or a narrow
/// split) it is the iOS 26 floating tab bar with Home, Activity, Shared and Trips and a
/// separate + for Add entry; in a regular width (iPad) a `NavigationSplitView` with a sidebar.
/// Both read and write the same `ShellRoute`, so resizing keeps the place.
struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var shell: ShellModel

    var body: some View {
        Group {
            if sizeClass == .regular {
                SplitShell(shell: shell)
            } else {
                TabShell(shell: shell)
            }
        }
        .environment(shell)
        // Today moves on at midnight and when the app comes back, so income dated on the new
        // day leaves Expected for Left to spend without a relaunch (MAZ-136).
        .task { await shell.followDayChanges() }
        .onChange(of: scenePhase) {
            if scenePhase == .active { shell.refreshToday() }
        }
        .sheet(isPresented: $shell.route.isAddEntryPresented, onDismiss: shell.sheetDismissed) {
            EntryFormSheet(mode: .new).environment(shell)
        }
        .sheet(item: $shell.editingEntry, onDismiss: shell.sheetDismissed) { request in
            EntryFormSheet(mode: .edit(request.entry)).environment(shell)
        }
        .accessibilityIdentifier(shell.isDemo ? "root.demo" : "root.signedIn")
    }
}

/// What the tab bar selects: a tab, or the separate + (which opens Add entry and never
/// becomes the selected tab).
enum TabSelection: Hashable {
    case tab(AppTab)
    case add
}

private struct TabShell: View {
    @Bindable var shell: ShellModel

    var body: some View {
        TabView(selection: selection) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Tab(tab.title, systemImage: Self.symbol(tab), value: TabSelection.tab(tab)) {
                    TabStack(tab: tab)
                }
                .accessibilityIdentifier("tab.\(tab.rawValue)")
            }
            // The separate circular button at the trailing end of the iOS 26 tab bar.
            Tab("Add entry", systemImage: "plus", value: TabSelection.add, role: .search) {
                Color.clear
            }
            .accessibilityIdentifier("tab.add")
        }
        .tint(PennyColor.tint)
        .modifier(ToastOverlay(bottomPadding: 72))
        .sheet(isPresented: $shell.route.isSettingsPresented) {
            NavigationStack(path: $shell.route.settingsPath) {
                SettingsView(onDone: { shell.route.isSettingsPresented = false })
                    .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
            }
            .environment(shell)
        }
    }

    private var selection: Binding<TabSelection> {
        Binding(
            get: { .tab(shell.route.tab) },
            set: { next in
                switch next {
                case .tab(let tab): shell.route.select(tab)
                case .add: shell.route.openAddEntry()
                }
            })
    }

    static func symbol(_ tab: AppTab) -> String {
        switch tab {
        case .home: "house"
        case .activity: "list.bullet"
        case .shared: "person.2"
        case .trips: "airplane"
        }
    }
}

/// One tab's navigation stack, bound to the tab's path in `ShellRoute`.
struct TabStack: View {
    @Environment(ShellModel.self) private var shell
    let tab: AppTab

    var body: some View {
        NavigationStack(path: Binding(get: { shell.route.path(for: tab) }, set: { shell.route.setPath($0, for: tab) }))
        {
            TabRoot(tab: tab)
                .navigationDestination(for: DetailRoute.self) { DetailPage(route: $0) }
        }
    }
}

struct TabRoot: View {
    let tab: AppTab

    var body: some View {
        switch tab {
        case .home: HomeView()
        case .activity: ActivityView()
        case .shared: SharedView()
        case .trips: TripsView()
        }
    }
}

struct DetailPage: View {
    let route: DetailRoute

    var body: some View {
        switch route {
        case .household(let id): HouseholdDetailView(id: id)
        case .householdExpense(let household, let expense): HouseholdDetailView(id: household, expenseID: expense)
        case .trip(let id): TripDetailView(id: id)
        case .entry(let id): EntryDetailView(id: id)
        case .moneyFlow: MoneyFlowView()
        case .insights: InsightsView()
        case .calendar: CalendarView()
        case .categorySpending(let ids, let title): CategorySpendingView(categoryIds: ids, title: title)
        }
    }
}

/// iPad: a sidebar (Home, Activity; Together: Shared, Trips; Manage: Recurring, Accounts,
/// Categories; the account with its sync status and Settings) and a detail column.
private struct SplitShell: View {
    @Bindable var shell: ShellModel

    var body: some View {
        NavigationSplitView {
            Sidebar(shell: shell)
        } detail: {
            detail
        }
        .modifier(ToastOverlay(bottomPadding: 16))
    }

    @ViewBuilder
    private var detail: some View {
        switch shell.route.sidebarSelection {
        case .tab(let tab):
            TabStack(tab: tab).id(tab)
        case .manage(let page):
            NavigationStack {
                SettingsPage(route: page)
            }
            .id(page)
        case .settings:
            // Its own identity, like the tab and Manage stacks: the column then never reuses
            // another stack's state (a [DetailRoute] path) for this [SettingsRoute] one
            // (MAZ-141: a crash going back from Currency, `NavigationColumnState.boundPathChange`).
            NavigationStack(path: $shell.route.settingsPath) {
                SettingsView()
                    .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
            }
            .id(SidebarItem.settings)
        }
    }
}

private struct Sidebar: View {
    @Bindable var shell: ShellModel

    var body: some View {
        List(selection: selection) {
            Section {
                item(.tab(.home), "Home", "house")
                item(.tab(.activity), "Activity", "list.bullet")
            }
            Section("Together") {
                item(.tab(.shared), "Shared", "person.2")
                item(.tab(.trips), "Trips", "airplane")
            }
            Section("Manage") {
                ForEach(SettingsRoute.manage, id: \.self) { page in
                    item(.manage(page), page.title, Self.symbol(page))
                }
            }
        }
        .navigationTitle("Penny")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add entry", systemImage: "plus") { shell.route.openAddEntry() }
                    .accessibilityIdentifier("sidebar.add")
            }
        }
        .safeAreaInset(edge: .bottom) {
            SidebarFooter(shell: shell)
        }
    }

    private var selection: Binding<SidebarItem?> {
        Binding(
            get: { shell.route.sidebarSelection }, set: { if let next = $0 { shell.route.sidebarSelection = next } })
    }

    private func item(_ value: SidebarItem, _ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .tag(value)
            .accessibilityIdentifier("sidebar.\(title.lowercased())")
    }

    static func symbol(_ page: SettingsRoute) -> String {
        switch page {
        case .recurring: "repeat"
        case .accounts: "wallet.bifold"
        case .categories: "tag"
        default: "gearshape"
        }
    }
}

private struct SidebarFooter: View {
    @Bindable var shell: ShellModel

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(shell.account?.email ?? "Demo account").font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(SyncText.line(shell.workspace.sync)).font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer()
            GlassIconButton("Settings", systemImage: "gearshape") { shell.route.sidebarSelection = .settings }
                .accessibilityIdentifier("sidebar.settings")
        }
        .padding(Metrics.gutter)
        .accessibilityElement(children: .contain)
    }
}
