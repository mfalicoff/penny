import PennyAccessibility
import XCTest

/// The iPad Activity detail (MAZ-182): in portrait the detail beside the list collapsed to a
/// few points and wrapped the entry's title letter by letter. It must keep a readable width in
/// portrait and landscape: beside the list when both fit, otherwise pushed over it.
final class IPadActivityLayoutTests: PennyUITestCase {
    private static let title = "Corner bakery croissants"

    @MainActor
    func test_whenAnEntryIsOpenInPortraitOrLandscape_ActivityDetail_ShouldKeepAReadableWidth() async throws {
        guard Device.isPad else { throw XCTSkip("iPhone pushes the entry over the list.") }
        let stack = try await stack()
        let account = try await makeAccount("ipad-activity-layout")
        let id = "ipad-activity-layout-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token,
            [Stack.Transaction(id: id, title: Self.title, cents: 875, categoryID: "food")])
        defer { XCUIDevice.shared.orientation = .portrait }
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            let penny = try await launch()
            try penny.signIn(email: account.email, password: account.password)
            try penny.openActivity()
            try penny.openEntry(id)
            let name = orientation == .portrait ? "portrait" : "landscape"
            screenshot("activity-detail-\(name)")
            // The detail's heading keeps a readable line, and no copy of the title (the row may wrap
            // it onto two lines) is squeezed into a column of letters.
            let widths = app.staticTexts.matching(NSPredicate(format: "label == %@", Self.title))
                .allElementsBoundByIndex
                .filter { $0.exists && !$0.frame.isEmpty && app.windows.firstMatch.frame.intersects($0.frame) }
                .map(\.frame.width)
            XCTAssertGreaterThan(widths.max() ?? 0, 200, "\(name): the detail's title is narrower than a line")
            XCTAssertGreaterThan(widths.min() ?? 0, 60, "\(name): a title is squeezed to \(widths.min() ?? 0) points")
            app.terminate()
        }
    }
}
