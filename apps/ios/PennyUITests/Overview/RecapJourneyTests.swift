import PennyAccessibility
import XCTest

/// The monthly recap (MAZ-292) on the demo's sample data, which has last month's entries too, so
/// no server is needed: the banner in the first days of a month opens the recap and, dismissed,
/// stays gone across a relaunch; Insights' Recap button opens last month's recap.
final class RecapJourneyTests: PennyUITestCase {
    @MainActor
    private func launchDemo(today: String) async throws -> Penny {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.today = today
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    @MainActor
    private func goBack(_ penny: Penny) throws {
        let back = penny.app.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
        guard back.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No back button")
        }
        back.tap()
    }

    @MainActor
    func test_whenTheFirstWeekOfAMonth_RecapBanner_ShouldOpenTheRecapAndStayDismissed() async throws {
        let penny = try await launchDemo(today: "2026-11-03")
        try penny.wait(for: AccessibilityID.Recap.banner)
        screenshot("recap-banner-home")
        try penny.tap(AccessibilityID.Recap.banner)
        try penny.wait(for: AccessibilityID.Recap.screen)
        try penny.wait(for: AccessibilityID.Recap.spent)
        try penny.wait(for: AccessibilityID.Recap.highlights)
        screenshot("recap-october")
        try goBack(penny)
        try penny.wait(for: AccessibilityID.Screen.home)
        try penny.tap(AccessibilityID.Recap.bannerDismiss)
        try penny.waitForAbsence(of: AccessibilityID.Recap.banner)
        // Dismissed on this device for October: a relaunch doesn't bring it back.
        let again = try await relaunch()
        try again.waitForShell()
        try again.wait(for: AccessibilityID.Home.hero)
        XCTAssertFalse(again.element(AccessibilityID.Recap.banner).exists)
    }

    @MainActor
    func test_whenInsightsRecapIsTapped_Recap_ShouldOpenLastMonthWithItsChanges() async throws {
        let penny = try await launchDemo(today: Stack.defaultToday)
        try penny.openInsights()
        // Mid-month: no banner.
        XCTAssertFalse(penny.element(AccessibilityID.Recap.banner).exists)
        try penny.tap(AccessibilityID.Recap.insightsButton)
        try penny.wait(for: AccessibilityID.Recap.screen)
        let month = try penny.wait(for: AccessibilityID.Recap.month)
        XCTAssertTrue(month.label.contains("September"), month.label)
        try penny.wait(for: AccessibilityID.Recap.spent)
        try penny.wait(for: AccessibilityID.Recap.money)
        // The demo's September has no month before it: no category changes, and the bar says so.
        let previous = try penny.wait(for: AccessibilityID.Recap.bar("previous"))
        XCTAssertTrue(previous.label.contains("to compare with"), previous.label)
    }
}
