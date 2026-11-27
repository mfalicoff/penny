import PennyAccessibility
import XCTest

/// The year in review (MAZ-292, phase 2) on the demo's sample data, which has this month's and last
/// month's entries and two trips, so no server is needed: Insights' card opens the four pages, which
/// turn by a tap on either side or a swipe and never on their own; Share your year makes the image
/// and its switch shows amounts. In January the year's banner takes the recap banner's place until
/// it's dismissed.
final class YearReviewJourneyTests: PennyUITestCase {
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
    func test_whenOpenedFromInsights_YearReview_ShouldPageThroughAndShareWithAmountsHiddenFirst() async throws {
        let penny = try await launchDemo(today: "2026-12-28")
        try penny.openInsights()
        try penny.tap(AccessibilityID.YearReview.insightsCard)
        try penny.wait(for: AccessibilityID.YearReview.screen)
        try penny.wait(for: AccessibilityID.YearReview.page("categories"))
        try penny.wait(for: AccessibilityID.YearReview.total)
        let progress = try penny.wait(for: AccessibilityID.YearReview.progress)
        XCTAssertEqual(progress.value as? String, "1 of 4")
        screenshot("year-review-categories")
        // A tap on the trailing side, then a swipe, then a tap again: one page each.
        try penny.nextYearReviewPage(from: "categories")
        try penny.wait(for: AccessibilityID.YearReview.page("trips"))
        try penny.wait(for: AccessibilityID.YearReview.trip("demo-trip"))
        try penny.wait(for: AccessibilityID.YearReview.trip("demo-trip-city"))
        try penny.swipeYearReviewPage(from: "trips")
        try penny.wait(for: AccessibilityID.YearReview.page("shared"))
        try penny.nextYearReviewPage(from: "shared")
        try penny.wait(for: AccessibilityID.YearReview.page("facts"))
        try penny.wait(for: AccessibilityID.YearReview.fact("quiet"))
        XCTAssertEqual(progress.value as? String, "4 of 4")
        // Past the last page nothing moves; the leading side goes back.
        try penny.nextYearReviewPage(from: "facts")
        try penny.wait(for: AccessibilityID.YearReview.page("facts"))
        try penny.previousYearReviewPage(from: "facts")
        try penny.wait(for: AccessibilityID.YearReview.page("shared"))
        // Share your year: hidden amounts by default, then shown.
        try penny.tap(AccessibilityID.YearReview.share)
        try penny.wait(for: AccessibilityID.YearReview.shareScreen)
        try penny.waitForYearShareImage()
        let image = try penny.wait(for: AccessibilityID.YearReview.shareImage)
        let hidden = image.value as? String ?? ""
        XCTAssertTrue(hidden.contains("Where my money went"), hidden)
        XCTAssertFalse(hidden.contains("$"), hidden)
        XCTAssertFalse(hidden.contains("Weekend away"), "never a trip's name: \(hidden)")
        XCTAssertEqual(try penny.wait(for: AccessibilityID.YearReview.shareAmounts).value as? String, "0")
        screenshot("year-review-share")
        try penny.showYearShareAmounts()
        let shown = image.value as? String ?? ""
        XCTAssertTrue(shown.contains("$"), shown)
        XCTAssertFalse(shown.contains("Dinner out"), "never an entry's title: \(shown)")
        screenshot("year-review-share-amounts")
        try penny.tap(AccessibilityID.YearReview.shareClose)
        try penny.waitForAbsence(of: AccessibilityID.YearReview.shareScreen)
        try penny.tap(AccessibilityID.YearReview.close)
        try penny.waitForAbsence(of: AccessibilityID.YearReview.screen)
        try penny.wait(for: AccessibilityID.Screen.insights)
    }

    @MainActor
    func test_whenJanuaryStarts_YearBanner_ShouldShowInsteadOfTheRecapBannerUntilDismissed() async throws {
        let penny = try await launchDemo(today: "2027-01-03")
        try penny.wait(for: AccessibilityID.YearReview.banner)
        XCTAssertFalse(penny.element(AccessibilityID.Recap.banner).exists, "the two banners never stack")
        screenshot("year-review-banner-home")
        try penny.tap(AccessibilityID.YearReview.banner)
        try penny.wait(for: AccessibilityID.YearReview.screen)
        try penny.tap(AccessibilityID.YearReview.close)
        try penny.waitForAbsence(of: AccessibilityID.YearReview.screen)
        try penny.tap(AccessibilityID.YearReview.bannerDismiss)
        try penny.waitForAbsence(of: AccessibilityID.YearReview.banner)
        // December's recap banner, still in its first 7 days, shows once the year's is dismissed.
        try penny.wait(for: AccessibilityID.Recap.banner)
        // Dismissed on this device for 2026: a relaunch doesn't bring it back.
        let again = try await relaunch()
        try again.waitForShell()
        try again.wait(for: AccessibilityID.Recap.banner)
        XCTAssertFalse(again.element(AccessibilityID.YearReview.banner).exists)
    }
}
