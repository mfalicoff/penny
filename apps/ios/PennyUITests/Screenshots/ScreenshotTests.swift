import PennyAccessibility
import XCTest

/// Representative screenshots for visual review (TestPlans/Screenshots.xctestplan, MAZ-122):
/// light and dark, the largest accessibility text size, Reduce Transparency and Reduce
/// Motion, the keyboard, and the iOS 26+ Liquid Glass control layer (tab bar, toolbars, the
/// sidebar on iPad). Uses the demo's fixed sample data at a pinned date, so captures are
/// comparable across runs; signed-out screens run against the stack.
final class ScreenshotTests: PennyUITestCase {
    struct Variant {
        let name: String
        var contentSize: String?
        var reduceTransparency = false
        var reduceMotion = false
    }

    static let variants = [
        Variant(name: "default"),
        Variant(name: "large-text", contentSize: "UICTContentSizeCategoryAccessibilityXL"),
        Variant(name: "reduce-transparency", reduceTransparency: true),
        Variant(name: "reduce-motion", reduceMotion: true),
    ]

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
        try await super.tearDown()
    }

    @MainActor
    func test_whenCapturingTheShell_Screenshots_ShouldCoverEveryAppearanceAndVariant() async throws {
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = appearance
            for variant in Self.variants {
                var options = LaunchOptions()
                options.usesStack = false
                options.demo = true
                options.contentSize = variant.contentSize
                options.reduceTransparency = variant.reduceTransparency
                options.reduceMotion = variant.reduceMotion
                let penny = try await launch(options)

                try penny.waitForShell()
                screenshot("home-\(variant.name)")
                try penny.openActivity()
                screenshot("activity-\(variant.name)")
                try penny.openSettings()
                screenshot("settings-\(variant.name)")
                app.terminate()
            }
        }
    }

    @MainActor
    func test_whenCapturingSignIn_Screenshots_ShouldIncludeTheKeyboardAndAnError() async throws {
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = appearance
            let penny = try await launch()
            try penny.wait(for: AccessibilityID.Auth.email)
            screenshot("sign-in")
            try penny.type("someone@penny.test", into: AccessibilityID.Auth.email)
            screenshot("sign-in-keyboard")
            try penny.type("wrong-password", into: AccessibilityID.Auth.password)
            try penny.tap(AccessibilityID.Auth.signIn)
            try penny.wait(for: AccessibilityID.Auth.error)
            screenshot("sign-in-error")
            app.terminate()
        }
    }
}
