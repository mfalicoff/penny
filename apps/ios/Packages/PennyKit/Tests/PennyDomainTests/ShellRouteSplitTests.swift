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
