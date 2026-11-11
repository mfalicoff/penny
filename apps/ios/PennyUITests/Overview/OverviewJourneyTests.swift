import PennyAccessibility
import XCTest

/// Home's overview, the money flow, Insights and the calendar (MAZ-77) on the demo's fixed
/// sample data at the pinned date, so no server is needed. Checks the order of Home, selection
/// and navigation, that choosing a day never changes the month's totals, the VoiceOver
/// summaries, and the accessibility-size layouts (the chart gives way to its value list).
final class OverviewJourneyTests: PennyUITestCase {
    @MainActor
    private func launchDemo(contentSize: String? = nil) async throws -> Penny {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.contentSize = contentSize
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    /// The pinned month's first day, `YYYY-MM-01`.
    @MainActor private static var firstOfMonth: String { String(Stack.defaultToday.prefix(8)) + "01" }

    @MainActor
    func test_whenHomeOpens_Home_ShouldLeadWithLeftToSpendThenProjectedRecentAndExplore() async throws {
        let penny = try await launchDemo()
        let hero = try penny.wait(for: AccessibilityID.Home.hero)
        XCTAssertTrue(hero.label.hasPrefix("Left to spend"), hero.label)
        let projected = try penny.wait(for: AccessibilityID.Home.projected)
        XCTAssertTrue(projected.label.hasPrefix("Projected remaining"), projected.label)
        XCTAssertNotEqual(hero.label, projected.label, "recorded and projected are distinct")
        XCTAssertLessThan(hero.frame.minY, projected.frame.minY, "Left to spend leads")
        try penny.wait(for: AccessibilityID.Home.flow)
        try penny.wait(for: AccessibilityID.Home.recent)
        if !Device.isPad {
            let flow = penny.element(AccessibilityID.Home.flow)
            XCTAssertTrue((flow.value as? String)?.hasPrefix("Came in") == true, "\(flow.value ?? "")")
        }
        try penny.tap(AccessibilityID.Home.exploreCalendar)
        try penny.wait(for: AccessibilityID.Screen.calendar)
        screenshot("overview-calendar")
    }

    @MainActor
    func test_whenARowIsTapped_MoneyFlow_ShouldFocusItAndClearTheFocus() async throws {
        let penny = try await launchDemo()
        try penny.tap(AccessibilityID.Home.exploreMoneyFlow)
        try penny.wait(for: AccessibilityID.Screen.moneyFlow)
        try penny.wait(for: AccessibilityID.Overview.flowTotals)
        try penny.wait(for: AccessibilityID.Overview.flowChart)
        let home = try penny.wait(for: AccessibilityID.Overview.flowNode("expense:home"))
        XCTAssertTrue(home.label.contains("of spending"), home.label)
        home.tap()
        try penny.wait(for: AccessibilityID.Overview.flowFocus)
        XCTAssertTrue(penny.element(AccessibilityID.Overview.flowNode("expense:home")).isSelected)
        screenshot("overview-money-flow-focused")
        try penny.tap(AccessibilityID.Overview.flowFocusClear)
        try penny.waitForAbsence(of: AccessibilityID.Overview.flowFocus)
        try penny.wait(for: AccessibilityID.Overview.flowDetails)
    }

    @MainActor
    func test_whenADayIsChosen_Calendar_ShouldFilterTheDayButKeepTheMonthTotals() async throws {
        let penny = try await launchDemo()
        try penny.tap(AccessibilityID.Home.exploreCalendar)
        let totals = try penny.wait(for: AccessibilityID.Overview.calendarTotals).label
        let first = try penny.wait(for: AccessibilityID.Overview.day(Self.firstOfMonth))
        XCTAssertFalse(first.label.isEmpty)
        first.tap()
        XCTAssertTrue(penny.element(AccessibilityID.Overview.day(Self.firstOfMonth)).isSelected)
        try penny.wait(for: AccessibilityID.Overview.calendarDayEntries)
        XCTAssertEqual(penny.element(AccessibilityID.Overview.calendarTotals).label, totals)
        try penny.tap(AccessibilityID.Overview.calendarToday)
        XCTAssertEqual(penny.element(AccessibilityID.Overview.calendarTotals).label, totals)
    }

    @MainActor
    func test_whenACategoryIsChosen_Insights_ShouldOpenItsEntries() async throws {
        let penny = try await launchDemo()
        try penny.tap(AccessibilityID.Home.exploreInsights)
        try penny.wait(for: AccessibilityID.Screen.insights)
        try penny.wait(for: AccessibilityID.Overview.insightsComparison)
        let row = try penny.wait(for: AccessibilityID.Overview.category("home"))
        XCTAssertTrue(row.label.contains("of spending"), row.label)
        row.tap()
        try penny.wait(for: AccessibilityID.Screen.categorySpending)
        try penny.wait(for: AccessibilityID.Overview.categoryTotal)
    }

    @MainActor
    func test_whenTextIsAtTheLargestAccessibilitySize_Overview_ShouldListValuesInsteadOfTheChart() async throws {
        let penny = try await launchDemo(contentSize: "UICTContentSizeCategoryAccessibilityXXXL")
        try penny.wait(for: AccessibilityID.Home.hero)
        try penny.wait(for: AccessibilityID.Home.projected)
        screenshot("overview-home-xxxl")
        try penny.tap(AccessibilityID.Home.exploreMoneyFlow)
        try penny.wait(for: AccessibilityID.Overview.flowDetails)
        XCTAssertFalse(penny.element(AccessibilityID.Overview.flowChart).exists, "the list replaces the chart")
        screenshot("overview-money-flow-xxxl")
    }
}
