import PennyAccessibility
import XCTest

/// Layout with the keyboard up (MAZ-179, from the MAZ-122 card captures): the demo link must not
/// cover Sign in while typing, and Activity's No results must not cover the totals or the
/// server-results line, at the default and the largest accessibility text size.
final class KeyboardLayoutTests: PennyUITestCase {
    private static let sizes: [(name: String, contentSize: String?)] = [
        ("default", nil), ("ax-xxxl", "UICTContentSizeCategoryAccessibilityXXXL"),
    ]

    @MainActor
    func test_whenTypingOnSignIn_TheDemoLink_ShouldNotCoverSignIn() async throws {
        for size in Self.sizes {
            var options = LaunchOptions()
            options.contentSize = size.contentSize
            let penny = try await launch(options)
            try penny.type("someone@penny.test", into: AccessibilityID.Auth.email)
            guard app.keyboards.firstMatch.waitForExistence(timeout: 5) else {
                throw UIExpectationFailed(description: "\(size.name): no keyboard after typing the email")
            }
            screenshot("sign-in-keyboard-\(size.name)")
            let signIn = try penny.wait(for: AccessibilityID.Auth.signIn)
            let demo = penny.element(AccessibilityID.Auth.tryDemo)
            if demo.exists, demo.frame.intersects(signIn.frame) {
                throw UIExpectationFailed(description: "\(size.name): the demo link covers Sign in")
            }
            app.terminate()
        }
    }

    @MainActor
    func test_whenSearchFindsNothingWithTheKeyboardUp_NoResults_ShouldNotCoverTheTotalsOrScope() async throws {
        let stack = try await stack()
        let account = try await makeAccount("keyboard-search")
        let id = "keyboard-search-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransactions(
            token: account.token,
            [Stack.Transaction(id: id, title: "Corner bakery croissants", cents: 875, categoryID: "food")])
        for size in Self.sizes {
            var options = LaunchOptions()
            options.contentSize = size.contentSize
            let penny = try await launch(options)
            try penny.signIn(email: account.email, password: account.password)
            try penny.openActivity()
            try penny.waitForEntry(id)
            // No Return: the keyboard stays up.
            try penny.search("zzqxv nothing here")
            let empty = try penny.wait(for: AccessibilityID.Activity.searchEmpty, timeout: 30)
            let scope = try penny.wait(for: AccessibilityID.Journeys.searchScopeServer, timeout: 30)
            let totals = try penny.wait(for: AccessibilityID.Activity.totals)
            guard app.keyboards.firstMatch.exists else {
                throw UIExpectationFailed(description: "\(size.name): the keyboard went away")
            }
            screenshot("search-empty-keyboard-\(size.name)")
            for (name, other) in [("the server-results line", scope), ("the totals", totals)]
            where empty.frame.intersects(other.frame) {
                throw UIExpectationFailed(description: "\(size.name): No results covers \(name)")
            }
            app.terminate()
        }
    }
}
