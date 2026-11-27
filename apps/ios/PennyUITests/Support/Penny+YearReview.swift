import PennyAccessibility
import XCTest

/// The year in review (MAZ-292, phase 2): paging by a tap on either side or a swipe, Share your
/// year's image and switch, and the system share sheet.
@MainActor
extension Penny {
    /// Taps the trailing side of the page on show: the next page.
    func nextYearReviewPage(from page: String) throws {
        let current = try wait(for: AccessibilityID.YearReview.page(page))
        current.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.6)).tap()
    }

    /// Taps the leading side of the page on show: the previous page.
    func previousYearReviewPage(from page: String) throws {
        let current = try wait(for: AccessibilityID.YearReview.page(page))
        current.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.6)).tap()
    }

    /// Swipes the page on show toward the leading edge: the next page.
    func swipeYearReviewPage(from page: String) throws {
        try wait(for: AccessibilityID.YearReview.page(page)).swipeLeft()
    }

    /// Waits until Share your year's image is made (Share… turns on with it).
    func waitForYearShareImage(timeout: TimeInterval = Penny.timeout) throws {
        try wait(for: AccessibilityID.YearReview.shareImage, timeout: timeout)
        let send = try wait(for: AccessibilityID.YearReview.shareSend, timeout: timeout)
        let enabled = NSPredicate(format: "isEnabled == true")
        let result = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: enabled, object: send)], timeout: timeout)
        guard result == .completed else { throw UIExpectationFailed(description: "The share image was not made") }
    }

    /// Turns on Show amounts and names, and waits for the image that shows them.
    func showYearShareAmounts() throws {
        let toggle = try wait(for: AccessibilityID.YearReview.shareAmounts)
        let switchControl = toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle
        switchControl.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        guard toggle.waitForValue("1", timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "Show amounts and names did not turn on")
        }
        try waitForYearShareImage()
    }

    /// Waits for the system share sheet over Share your year. It belongs to the system, so only
    /// its presence is checked.
    func waitForShareSheet(timeout: TimeInterval = Penny.timeout) {
        let sheet = app.otherElements["ActivityListView"].firstMatch
        let copy = app.buttons["Copy"].firstMatch
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !sheet.exists, !copy.exists {
            _ = sheet.waitForExistence(timeout: 1)
        }
    }
}

extension XCUIElement {
    /// Waits until the element's value reads `value` (a switch's "0" or "1").
    func waitForValue(_ value: String, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "value == %@", value)
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout)
            == .completed
    }
}
