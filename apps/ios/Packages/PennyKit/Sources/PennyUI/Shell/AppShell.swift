import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The signed-in (or demo) shell. In a compact width (iPhone, iPad Slide Over or a narrow
/// split) it is the floating glass tab bar with Home, Activity, Shared and Trips and a
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
        // The Home Screen widgets follow the account's ledger (MAZ-80); never the demo's.
        .modifier(WidgetPublishing(shell: shell))
        // Today moves on at midnight and when the app comes back, so income dated on the new
        // day leaves Expected for Left to spend without a relaunch (MAZ-136).
        .task { await shell.followDayChanges() }
        // The account's name and picture, and whether to ask for a name (MAZ-171).
        .task { await shell.profile.refreshSummary() }
        .sheet(isPresented: namePrompt) {
            NamePromptSheet().environment(shell)
        }
        // MAZ-129: crash and performance reports, and asking for them once.
        .modifier(ClientMonitoring(shell: shell))
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                shell.refreshToday()
                // A name or picture changed on another device shows when the app comes back.
                Task { await shell.profile.refreshSummary() }
                // MAZ-172: an emailed link opened in the browser shows as verified on return.
                if shell.auth?.server?.emailEnabled == true, shell.profile.awaitsVerification {
                    Task { await shell.profile.refresh() }
                }
            }
        }
        // On iPad Settings is the detail column, so Add entry opens over it instead of closing
        // it (ShellRoute.settingsIsColumn). In a compact width it is a sheet again, and only one
        // sheet shows at a time.
        .onChange(of: sizeClass, initial: true) {
            shell.route.settingsIsColumn = sizeClass == .regular
            if sizeClass != .regular, shell.route.isAddEntryPresented { shell.route.isSettingsPresented = false }
        }
        .sheet(isPresented: $shell.route.isAddEntryPresented, onDismiss: shell.sheetDismissed) {
            EntryFormSheet(mode: .new).environment(shell)
        }
        .sheet(item: $shell.editingEntry, onDismiss: shell.sheetDismissed) { request in
            EntryFormSheet(mode: .edit(request.entry)).environment(shell)
        }
        // The calendar is a sheet over Home on iPhone and iPad (`calendar` card, MAZ-254).
        .sheet(isPresented: $shell.route.isCalendarPresented, onDismiss: shell.sheetDismissed) {
            NavigationStack { CalendarView().pennySolidBars() }.environment(shell)
        }
        // The year in review (MAZ-292), over everything, from the Insights card or the January banner.
        // iPad shows the iPhone layout, centered, as the recap does.
        .yearReviewCover($shell.yearReview) { request in
            YearReviewView(year: request.year).environment(shell)
        }
        .accessibilityIdentifier(shell.isDemo ? "root.demo" : "root.signedIn")
    }

    /// "What should people call you?" over Home, once, while no other sheet is up.
    private var namePrompt: Binding<Bool> {
        Binding(
            get: {
                shell.profile.showsNamePrompt && !shell.route.isAddEntryPresented && shell.editingEntry == nil
                    && !shell.route.isCalendarPresented && !shell.route.isSettingsPresented
                    && shell.route.householdStart == nil
            },
            set: { shown in if !shown { shell.profile.markPromptShown() } })
    }
}

/// The iPhone shell (`home` card and every tab screen, MAZ-254): the four tabs in one Liquid
/// Glass capsule and, beside it, the separate copper + circle for Add entry. The system tab bar
/// can't draw that (a tab with the search role renders as a fifth item inside the bar, and one
/// item can't have its own tint), so `TabView` keeps each tab's stack and state with its own bar
/// hidden, and `PennyTabBar` is drawn over the content.
private struct TabShell: View {
    @Bindable var shell: ShellModel

    var body: some View {
        TabView(selection: Binding(get: { shell.route.tab }, set: { shell.route.select($0) })) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Tab(tab.title, systemImage: PennyTabBar.symbol(tab), value: tab) {
                    TabStack(tab: tab, underTabBar: true)
                }
            }
        }
        .tint(PennyColor.tint)
        // Over the content, and under the keyboard rather than above it. Activity's root shows its
        // search bar in the tab bar's place instead, above the keyboard while typing (`activity`
        // card, MAZ-255).
        .overlay(alignment: .bottom) {
            if shell.route.tab == .activity, shell.route.path(for: .activity).isEmpty {
                ActivitySearchBar(shell: shell)
            } else {
                PennyTabBar(shell: shell).ignoresSafeArea(.keyboard, edges: .bottom)
            }
        }
        // Under the Settings sheet the toast shows in the sheet instead (Recurring's Dismiss, MAZ-290).
        .modifier(ToastOverlay(bottomPadding: 72, showsToast: !shell.route.isSettingsPresented))
        .sheet(isPresented: $shell.route.isSettingsPresented, onDismiss: shell.sheetDismissed) {
            NavigationStack(path: $shell.route.settingsPath) {
                SettingsView(onDone: { shell.route.isSettingsPresented = false })
                    .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
            }
            .modifier(ToastOverlay(bottomPadding: 16, playsHaptics: false))
            .environment(shell)
        }
    }
}

/// The cards' tab bar: Home, Activity, Shared and Trips in a glass capsule (the selected tab
/// copper on the neutral fill), and the copper glass + that opens Add entry. Both are opaque
/// surfaces with Reduce Transparency (`pennyGlass`). The labels stay at the bar's size, as the
/// system's do; at large text sizes a long press shows them in the large content viewer.
struct PennyTabBar: View {
    @Bindable var shell: ShellModel

    static let height: Double = 62
    /// Activity's bottom search bar (`activity` card's `.searchbar`).
    static let searchHeight: Double = 52

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 0) {
                    ForEach(AppTab.allCases, id: \.self) { tab in item(tab) }
                }
                .padding(4)
                .frame(height: Self.height)
                .pennyGlass(in: Capsule())
                Button {
                    shell.route.openAddEntry()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: Self.height, height: Self.height)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .pennyGlass(in: Circle(), tinted: true)
                .accessibilityLabel("Add entry")
                .accessibilityShowsLargeContentViewer()
                .accessibilityIdentifier("tab.add")
            }
        }
        .padding(.horizontal, 16)
        .dynamicTypeSize(...DynamicTypeSize.large)
        // Only as tall as the bar, so the content above it scrolls and takes touches as before.
        .frame(height: Self.height)
        .fixedSize(horizontal: false, vertical: true)
        // Its own container, so the shell's root identifier never replaces the tabs' own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tab.bar")
    }

    private func item(_ tab: AppTab) -> some View {
        let isSelected = shell.route.tab == tab
        return Button {
            shell.route.select(tab)
        } label: {
            VStack(spacing: 2) {
                Image(systemName: Self.symbol(tab)).font(.system(size: 20, weight: .medium))
                    .frame(height: 26)
                Text(tab.title).font(.system(size: 10.5, weight: .semibold))
            }
            .foregroundStyle(isSelected ? PennyColor.tint : PennyColor.label)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(isSelected ? PennyColor.fill : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier("tab.\(tab.rawValue)")
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
    /// iPhone: the page sits under `PennyTabBar` (MAZ-254).
    var underTabBar = false

    var body: some View {
        NavigationStack(path: Binding(get: { shell.route.path(for: tab) }, set: { shell.route.setPath($0, for: tab) }))
        {
            TabRoot(tab: tab)
                .pennySolidBars()
                .underPennyTabBar(underTabBar)
                .navigationDestination(for: DetailRoute.self) {
                    DetailPage(route: $0).pennySolidBars().underPennyTabBar(underTabBar)
                }
        }
        // Opening an entry, a household or a trip plays the selection haptic (MAZ-287).
        .pennyHaptic(.open, trigger: shell.route.path(for: tab)) { old, new in
            new.count > old.count && new.last.map(DetailRoute.opensItem) == true
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
        case .householdExpense(let household, let expense):
            HouseholdExpenseView(householdID: household, expenseID: expense)
        case .householdHistory(let household): HouseholdHistoryView(householdID: household)
        case .trip(let id): TripDetailView(id: id)
        case .entry(let id): EntryDetailView(id: id)
        case .moneyFlow: MoneyFlowView()
        case .insights: InsightsView()
        case .categorySpending(let ids, let title): CategorySpendingView(categoryIds: ids, title: title)
        case .receiptInbox(let item): ReceiptInboxView(openItemID: item)
        case .recap(let month): RecapView(month: month)
        }
    }
}

/// iPad: a sidebar (Home, Activity; Together: Shared, Trips; Manage: Recurring, Accounts,
/// Categories; the account with its sync status and Settings) and a detail column.
private struct SplitShell: View {
    @Bindable var shell: ShellModel
    /// The sidebar shows beside the detail in landscape and starts hidden behind the system's
    /// toggle in portrait, where the detail takes the full width (`ipad-home-portrait`).
    @State private var columns = NavigationSplitViewVisibility.all
    /// The columns Penny set itself; a change to anything else came from the person.
    @State private var expectedColumns = NavigationSplitViewVisibility.all
    @State private var portrait: Bool?

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            Sidebar(shell: shell).pennySolidBars()
        } detail: {
            detail
        }
        // In portrait the balanced style keeps the sidebar tiled and puts it back when it is hidden;
        // the prominent-detail style lets it go, over the detail when shown.
        .modifier(SplitStyle(portrait: portrait == true))
        .onGeometryChange(for: Bool.self) {
            $0.size.height > $0.size.width
        } action: { isPortrait in
            portrait = isPortrait
        }
        // Only when the orientation changes, so a sidebar opened with the toggle stays open.
        .task(id: portrait) {
            guard let portrait else { return }
            setColumns(portrait ? .detailOnly : .all)
        }
        // In portrait a pick in the sidebar shows its page with the sidebar put away again.
        .onChange(of: shell.route.sidebarSelection) {
            if portrait == true { setColumns(.detailOnly) }
        }
        // The person showing or hiding the sidebar with the system's toggle: a light impact.
        .pennyHaptic(.sidebar, trigger: columns) { _, new in new != expectedColumns }
        .onChange(of: columns) { expectedColumns = columns }
        .modifier(ToastOverlay(bottomPadding: 16))
        // ⌘N opens Add entry wherever the iPad is (MAZ-254). An invisible button, so the shortcut
        // is in the window's key commands without a second visible control.
        .background {
            Button("Add entry") { shell.route.openAddEntry() }
                .keyboardShortcut("n", modifiers: .command)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    /// Penny changing the column visibility: the system's show and hide, started with `.snappy`
    /// (docs/design/motion.md, Navigation). The system follows Reduce Motion itself.
    private func setColumns(_ visibility: NavigationSplitViewVisibility) {
        guard columns != visibility else { return }
        expectedColumns = visibility
        withAnimation(.snappy) { columns = visibility }
    }

    /// The Settings column's path without the Manage pages, which have their own stack. Opening
    /// one sets `settingsPath` to it, and the Settings stack being replaced must not see its
    /// bound path change in that same update: SwiftUI crashes with
    /// `NavigationColumnState.boundPathChange` (MAZ-82, Settings › Categories on iPad).
    private var settingsColumnPath: Binding<[SettingsRoute]> {
        Binding(
            get: {
                let path = shell.route.settingsPath
                return path.first.map(SettingsRoute.manage.contains) == true ? [] : path
            },
            set: { shell.route.settingsPath = $0 })
    }

    @ViewBuilder
    private var detail: some View {
        switch shell.route.sidebarSelection {
        case .tab, .insights, .household, .trip:
            // Insights and each household and trip are pages of their tab's stack (MAZ-182).
            TabStack(tab: shell.route.tab).id(shell.route.tab)
        case .manage(let page):
            NavigationStack {
                SettingsPage(route: page)
            }
            .id(page)
        case .settings:
            // Its own identity, like the tab and Manage stacks: the column then never reuses
            // another stack's state (a [DetailRoute] path) for this [SettingsRoute] one
            // (MAZ-141: a crash going back from Currency, `NavigationColumnState.boundPathChange`).
            SettingsColumns(shell: shell, singleColumnPath: settingsColumnPath)
                .id(SidebarItem.settings)
        }
    }
}

/// The iPad sidebar (`ipad-*` cards, MAZ-182): the penny. mark; Home, Activity and Insights;
/// Together with each household and its balance, All households, the current and coming
/// trips with their start date, and All trips; Manage; and the account with its sync status
/// and Settings. The selected row is filled copper with white text.
private struct Sidebar: View {
    @Bindable var shell: ShellModel

    var body: some View {
        let selected = shell.route.sidebarSelection
        let together = together
        List {
            Section {
                item(.tab(.home), "Home", "house", selected: selected)
                item(.tab(.activity), "Activity", "list.bullet", selected: selected)
                item(.insights, "Insights", "chart.pie", selected: selected)
            } header: {
                SidebarBrand()
            }
            Section {
                ForEach(together.households) { row in
                    item(
                        row.item, row.name, SidebarTogether.householdSymbol, detail: row.detail, spoken: row.spoken,
                        selected: selected, id: "sidebar.household.\(householdID(row.item))")
                }
                // The Shared list (join with a code, create another household), MAZ-240.
                item(
                    .tab(.shared), together.sharedTitle, SidebarTogether.householdSymbol, selected: selected,
                    id: "sidebar.shared")
                ForEach(together.trips) { row in
                    item(
                        row.item, row.name, SidebarTogether.tripSymbol, detail: row.detail, spoken: row.spoken,
                        selected: selected, id: "sidebar.trip.\(tripID(row.item))")
                }
                item(
                    .tab(.trips), together.tripsTitle, SidebarTogether.tripSymbol, selected: selected,
                    id: "sidebar.trips")
            } header: {
                SidebarHeader("Together")
            }
            Section {
                ForEach(SettingsRoute.manage, id: \.self) { page in
                    item(.manage(page), page.title, Self.symbol(page), selected: selected)
                }
            } header: {
                SidebarHeader("Manage")
            }
        }
        .tint(PennyColor.tint)
        .navigationTitle("Penny")
        .toolbar(removing: .title)
        // Add entry is the copper capsule in the detail's toolbar (Home, Activity, Settings) and
        // ⌘N, not a + in the sidebar (MAZ-254).
        .safeAreaInset(edge: .bottom) {
            SidebarFooter(shell: shell, isSelected: selected == .settings).background(.bar)
        }
        .listStyle(.sidebar)
        .environment(\.defaultMinListRowHeight, Metrics.minTouchTarget)
        // Together lists each household with this month's balance (the Shared list may not be read yet).
        .task(id: shell.month) { await shell.households.refresh() }
    }

    private var together: SidebarTogether {
        SidebarTogether(
            households: shell.households.households, balances: shell.households.balances,
            ledgerTrips: shell.workspace.load.ledger?.trips ?? [], today: shell.today)
    }

    private func householdID(_ item: SidebarItem) -> String {
        if case .household(let id) = item { return id }
        return ""
    }

    private func tripID(_ item: SidebarItem) -> String {
        if case .trip(let id) = item { return id }
        return ""
    }

    /// A row: a button rather than the List's own selection, so the selected row is the card's
    /// solid copper fill with white text (the system's sidebar selection is gray, and outlined
    /// in the tint when focused).
    private func item(
        _ value: SidebarItem, _ title: String, _ symbol: String, detail: String? = nil, spoken: String? = nil,
        selected: SidebarItem, id: String? = nil
    ) -> some View {
        let isSelected = value == selected
        return Button {
            shell.route.sidebarSelection = value
        } label: {
            HStack(spacing: 12) {
                Label {
                    Text(title).lineLimit(1)
                } icon: {
                    Image(systemName: symbol).foregroundStyle(isSelected ? Color.white : PennyColor.tint)
                }
                Spacer(minLength: 8)
                if let detail {
                    Text(detail)
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? Color.white : PennyColor.secondaryLabel)
                        .lineLimit(1)
                        .accessibilityLabel(spoken ?? detail)
                }
            }
            .font(.body.weight(isSelected ? .semibold : .regular))
            .foregroundStyle(isSelected ? Color.white : PennyColor.label)
            .padding(.horizontal, 12)
            .frame(minHeight: Metrics.minTouchTarget)
            .background(
                isSelected ? PennyColor.tint : Color.clear,
                in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(id ?? "sidebar.\(title.lowercased())")
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

/// The copper leaf and the "penny." wordmark at the top of the sidebar.
private struct SidebarBrand: View {
    var body: some View {
        HStack(spacing: 10) {
            PennyMark(size: 34)
            Text("penny.").font(.title2.weight(.bold)).foregroundStyle(PennyColor.label)
        }
        .textCase(nil)
        .padding(.bottom, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Penny")
        .accessibilityAddTraits(.isHeader)
    }
}

/// A small upper-case section label ("TOGETHER", "MANAGE").
private struct SidebarHeader: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title.uppercased())
            .font(.footnote.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The account's picture or monogram, its name (else its email, MAZ-171) and sync status, and
/// Settings, which is selected (a tinted gear on a filled row) while Settings is shown.
private struct SidebarFooter: View {
    @Bindable var shell: ShellModel
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Monogram(face: shell.accountFace, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(shell.accountShortName).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(SyncText.line(shell.workspace.sync)).font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    // The sync status crossfades as it changes (MAZ-287).
                    .pennyCrossfade(shell.workspace.sync)
            }
            Spacer()
            Button {
                shell.route.sidebarSelection = .settings
            } label: {
                Image(systemName: "gearshape")
                    .font(.title3)
                    .foregroundStyle(isSelected ? PennyColor.tint : PennyColor.secondaryLabel)
                    .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            .accessibilityIdentifier("sidebar.settings")
        }
        .padding(10)
        .background(
            isSelected ? PennyColor.fill : Color.clear,
            in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
        )
        .padding(.horizontal, Metrics.gutter - 6)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
    }
}

/// The copper "+ Add entry" capsule in the iPad toolbar of Home, Activity and Settings
/// (`ipad-home`, `ipad-activity`, `ipad-settings`, MAZ-254). ⌘N opens Add entry from anywhere
/// on iPad (`SplitShell`), so the capsule carries no shortcut of its own.
struct AddEntryCapsule: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        Button {
            shell.route.openAddEntry()
        } label: {
            // An HStack, not a Label: the toolbar would draw a Label as its icon alone.
            HStack(spacing: 6) {
                Image(systemName: "plus")
                Text("Add entry")
            }
            .fontWeight(.semibold)
        }
        .buttonStyle(.glassProminent)
        .tint(PennyColor.tint)
    }
}

extension View {
    /// A tab page on iPhone (MAZ-254): the system tab bar hidden under `PennyTabBar`, and the
    /// page's content ending above the bar, so its last rows scroll clear of it as they do above
    /// the system's. Each page gets it itself: a `TabView`'s own inset doesn't reach its pages.
    @ViewBuilder
    func underPennyTabBar(_ active: Bool) -> some View {
        if active {
            #if os(iOS)
                toolbarVisibility(.hidden, for: .tabBar)
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        Color.clear.frame(height: PennyTabBar.height + 8).allowsHitTesting(false)
                    }
            #else
                self
            #endif
        } else {
            self
        }
    }
}

/// The iPad split view's style: the sidebar tiled beside the detail in landscape (`.balanced`),
/// and over the detail in portrait (`.prominentDetail`), where the detail keeps the full width.
private struct SplitStyle: ViewModifier {
    let portrait: Bool

    func body(content: Content) -> some View {
        if portrait {
            content.navigationSplitViewStyle(.prominentDetail)
        } else {
            content.navigationSplitViewStyle(.balanced)
        }
    }
}

extension DetailRoute {
    /// An entry, a household or a trip (with their pages): opening one plays the selection
    /// haptic (docs/design/motion.md#haptics-ios). Home's analysis pages and the inbox don't.
    /// The recap plays its own (`ShellModel.openRecap`).
    static func opensItem(_ route: DetailRoute) -> Bool {
        switch route {
        case .entry, .household, .householdExpense, .trip: true
        case .householdHistory, .moneyFlow, .insights, .categorySpending, .receiptInbox, .recap: false
        }
    }
}
