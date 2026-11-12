import PennyAccessibility
import XCTest

/// Add entry opened from a page pushed inside Settings on iPad (MAZ-78). Settings is the split
/// view's detail column there: Add entry opens over it and the page stays, instead of the
/// column switching to Home under the sheet, which crashed SwiftUI
/// (`NavigationColumnState.boundPathChange`). On iPhone Settings is a sheet that closes for
/// Add entry (`ShellRouteSplitTests`).
final class AddEntryOverSettingsTests: PennyUITestCase {
    @MainActor
    func test_whenAddEntryOpensFromAPushedSettingsPage_SplitShell_ShouldShowTheFormAndKeepTheSettingsPage()
        async throws
    {
        guard Device.isPad else { throw XCTSkip("iPhone Settings is a sheet; ShellRouteSplitTests covers it.") }
        let account = try await makeAccount("add-over-settings")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)

        try penny.tap(AccessibilityID.Sidebar.add)
        try penny.wait(for: AccessibilityID.Screen.addEntry)
        screenshot("add-entry-over-settings")
        try penny.tap(AccessibilityID.EntryForm.close)
        try penny.waitForAbsence(of: AccessibilityID.Screen.addEntry)

        try penny.wait(for: AccessibilityID.Screen.currency)
        XCTAssertEqual(penny.app.state, .runningForeground)
    }
}
