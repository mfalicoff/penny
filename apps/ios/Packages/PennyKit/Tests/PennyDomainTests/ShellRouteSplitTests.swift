import PennyDomain
import Testing

/// Add entry over Settings on iPad (MAZ-78): Settings is the split view's detail column there,
/// not a sheet, so opening Add entry must leave it (and the page pushed in it) where it is.
/// Closing it swapped the column's bound stack for Home's in the same update as the sheet
/// appeared, which crashed SwiftUI (`NavigationColumnState.boundPathChange`).
@Suite("Shell navigation on iPad")
struct ShellRouteSplitTests {
    @Test("whenSettingsIsTheIPadColumn_OpenAddEntry_ShouldKeepTheSettingsPageShown")
    func addEntryOverSettingsColumn() {
        var route = ShellRoute()
        route.settingsIsColumn = true
        route.sidebarSelection = .settings
        route.settingsPath = [.currency]
        route.openAddEntry()
        #expect(route.isAddEntryPresented)
        #expect(route.sidebarSelection == .settings)
        #expect(route.settingsPath == [.currency])

        route.open(.addEntry)
        #expect(route.sidebarSelection == .settings, "the widget link opens Add entry over it too")
    }

    @Test("whenSettingsIsASheet_OpenAddEntry_ShouldCloseItFirst")
    func addEntryClosesSettingsSheet() {
        var route = ShellRoute()
        route.openSettings(.currency)
        route.openAddEntry()
        #expect(route.isAddEntryPresented)
        #expect(!route.isSettingsPresented)
    }

    @Test("whenAManagePageIsTheIPadColumn_OpenAddEntry_ShouldKeepIt")
    func addEntryOverManagePage() {
        var route = ShellRoute()
        route.settingsIsColumn = true
        route.sidebarSelection = .manage(.categories)
        route.openAddEntry()
        #expect(route.sidebarSelection == .manage(.categories))
    }
}

/// The iPad sidebar lists Insights and each household and trip (MAZ-182, `ipad-*` cards).
@Suite("Sidebar households, trips and Insights")
struct ShellRouteSidebarTests {
    @Test("whenAHouseholdRowIsChosen_SidebarSelection_ShouldOpenItFromTheSharedRoot")
    func householdRow() {
        var route = ShellRoute()
        route.sidebarSelection = .household(id: "h1")
        #expect(route.tab == .shared)
        #expect(route.path(for: .shared) == [.household(id: "h1")])
        #expect(route.sidebarSelection == .household(id: "h1"))

        route.push(.householdExpense(householdID: "h1", expenseID: "e1"))
        #expect(route.sidebarSelection == .household(id: "h1"), "a page pushed on it keeps its row")
    }

    @Test("whenATripRowIsChosen_SidebarSelection_ShouldOpenItFromTheTripsRoot")
    func tripRow() {
        var route = ShellRoute()
        route.sidebarSelection = .trip(id: "t1")
        #expect(route.tab == .trips)
        #expect(route.path(for: .trips) == [.trip(id: "t1")])
        #expect(route.sidebarSelection == .trip(id: "t1"))
    }

    @Test("whenAllHouseholdsOrAllTripsIsChosen_SidebarSelection_ShouldShowTheList")
    func allRows() {
        var route = ShellRoute()
        route.sidebarSelection = .household(id: "h1")
        route.sidebarSelection = .tab(.home)
        route.sidebarSelection = .tab(.shared)
        #expect(route.path(for: .shared).isEmpty, "never reopens the household the stack kept")
        #expect(route.sidebarSelection == .tab(.shared))

        route.sidebarSelection = .trip(id: "t1")
        route.sidebarSelection = .tab(.trips)
        #expect(route.path(for: .trips).isEmpty)
        #expect(route.sidebarSelection == .tab(.trips))
    }

    @Test("whenInsightsIsChosen_SidebarSelection_ShouldShowItOnHomeAndHomeShouldLeaveIt")
    func insightsRow() {
        var route = ShellRoute(tab: .activity)
        route.sidebarSelection = .insights
        #expect(route.tab == .home)
        #expect(route.path(for: .home) == [.insights])
        #expect(route.sidebarSelection == .insights)

        route.sidebarSelection = .tab(.activity)
        route.sidebarSelection = .tab(.home)
        #expect(route.path(for: .home).isEmpty)
        #expect(route.sidebarSelection == .tab(.home))
    }

    @Test("whenADeepLinkOpensAHousehold_SidebarSelection_ShouldBeItsRow")
    func deepLinkSelectsRow() {
        var route = ShellRoute()
        route.settingsIsColumn = true
        route.sidebarSelection = .settings
        route.open(.household(id: "h2"))
        #expect(route.sidebarSelection == .household(id: "h2"))
        route.open(.trip(id: "t2"))
        #expect(route.sidebarSelection == .trip(id: "t2"))
    }

    @Test("whenHomeShowsAnotherPage_SidebarSelection_ShouldStayHome")
    func otherHomePages() {
        var route = ShellRoute()
        route.push(.moneyFlow)
        #expect(route.sidebarSelection == .tab(.home))
        route.setPath([.moneyFlow, .insights], for: .home)
        #expect(route.sidebarSelection == .tab(.home), "only Insights opened as the first page is its row")
    }

    @Test("whenTheCalendarOpens_ShellRoute_ShouldCloseTheSettingsSheetAndAddEntry")
    func calendarSheet() {
        var route = ShellRoute()
        route.openSettings()
        route.openCalendar()
        #expect(route.isCalendarPresented)
        #expect(!route.isSettingsPresented, "only one sheet shows at a time")
        route.openAddEntry()
        #expect(route.isAddEntryPresented)
        #expect(!route.isCalendarPresented, "Add entry replaces the calendar sheet")
    }

    @Test("whenALinkOpensOverTheCalendar_ShellRoute_ShouldCloseIt")
    func calendarClosesForLinks() {
        var route = ShellRoute()
        route.openCalendar()
        route.open(.trips)
        #expect(!route.isCalendarPresented)
        route.openCalendar()
        route.openSettings(.appearance)
        #expect(!route.isCalendarPresented)
    }

    @Test("whenACalendarRowIsChosen_ShellRoute_ShouldCloseTheSheetAndOpenThePageOnHome")
    func calendarRow() {
        var route = ShellRoute(tab: .home)
        route.push(.moneyFlow)
        route.openCalendar()
        route.openFromCalendar(.entry(id: "e1"))
        #expect(!route.isCalendarPresented)
        #expect(route.tab == .home)
        #expect(route.path(for: .home) == [.moneyFlow, .entry(id: "e1")])
        #expect(route.sidebarSelection == .tab(.home))
    }
}
