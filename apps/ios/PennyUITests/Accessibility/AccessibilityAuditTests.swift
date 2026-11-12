import PennyAccessibility
import XCTest

/// Automated accessibility audits (MAZ-82): Xcode's accessibility audit
/// (`performAccessibilityAudit`, the Accessibility Inspector's checks) on every main screen, in
/// light and dark, at the default and the largest accessibility text size, with Reduce Motion and
/// Reduce Transparency, plus explicit VoiceOver checks that every interactive element has a
/// label. Uses the demo's fixed data at the pinned date; sign-in runs against the stack.
///
/// Each audit's findings are attached as `audit-<screen>-<variant>.txt`. A finding fails the test
/// unless its type is one of `recordedDebt` (findings the first MAZ-82 run found, attached and
/// counted but not failing until their follow-up fixes them) or it matches `accepted`. Both are
/// recorded in `docs/ios-qa.md#accessibility`; remove a type from `recordedDebt` once its
/// findings are fixed, so the gate holds the line.
final class AccessibilityAuditTests: PennyUITestCase {
    struct Variant {
        let name: String
        var appearance = XCUIDevice.Appearance.light
        var contentSize: String?
        var reduceMotion = false
        var reduceTransparency = false
    }

    static let variants = [
        Variant(name: "light"),
        Variant(name: "dark", appearance: .dark),
        Variant(name: "xxxl", contentSize: "UICTContentSizeCategoryAccessibilityXXXL"),
        Variant(name: "dark-xxxl", appearance: .dark, contentSize: "UICTContentSizeCategoryAccessibilityXXXL"),
        Variant(name: "reduced", reduceMotion: true, reduceTransparency: true),
    ]

    /// A reviewed exception: an audit type, and text the issue's description or element must
    /// contain. Each has a reason in docs/ios-qa.md.
    struct Accepted {
        let type: XCUIAccessibilityAuditType
        let match: String
    }

    /// Reviewed audit findings that are not Penny's to fix (system controls) or are deliberate.
    /// Keep this list short and documented; never add an entry to make a red run green without
    /// recording why in docs/ios-qa.md.
    static let accepted: [Accepted] = []

    /// Audit types with known findings on iOS 27.0 (2026-11-12, docs/ios-qa.md#accessibility):
    /// low-contrast secondary text and chips, fixed-size text in the hero and banners, small hit
    /// areas on chips and links, text clipped at AX-XXXL, and one "potentially inaccessible text"
    /// on Activity that the audit reports without an element. Their findings are attached and
    /// counted, not failed. Every other type (element descriptions, traits) had none and fails on
    /// any new finding.
    static let recordedDebt: XCUIAccessibilityAuditType = [
        .contrast, .dynamicType, .hitRegion, .textClipped, .elementDetection,
    ]

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
        try await super.tearDown()
    }

    @MainActor
    private func launchDemo(_ variant: Variant) async throws -> Penny {
        XCUIDevice.shared.appearance = variant.appearance
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.contentSize = variant.contentSize
        options.reduceMotion = variant.reduceMotion
        options.reduceTransparency = variant.reduceTransparency
        options.seed = ContainerSeed(
            standardDefaults: ["penny.appearance": variant.appearance == .dark ? "dark" : "light"])
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    /// Audits the current screen, attaches the findings and returns the ones not accepted.
    @MainActor
    private func audit(_ screen: String, _ variant: Variant) throws -> [String] {
        var findings: [String] = []
        var unexpected: [String] = []
        try app.performAccessibilityAudit { issue in
            let element = issue.element.map { "\($0.elementType.rawValue) “\($0.label)” [\($0.identifier)]" } ?? "—"
            let line = "\(Self.name(issue.auditType)): \(issue.compactDescription) — \(element)"
            findings.append(line)
            let accepted =
                Self.recordedDebt.contains(issue.auditType)
                || Self.accepted.contains { rule in
                    issue.auditType == rule.type
                        && (issue.compactDescription.contains(rule.match) || element.contains(rule.match))
                }
            if !accepted { unexpected.append("\(screen)/\(variant.name): \(line)") }
            return true  // Recorded here; the test decides below, so one run lists every issue.
        }
        let attachment = XCTAttachment(
            string: findings.isEmpty ? "No issues." : findings.joined(separator: "\n"))
        attachment.name = "\(Device.name)-audit-\(screen)-\(variant.name).txt"
        attachment.lifetime = .keepAlways
        add(attachment)
        return unexpected
    }

    static func name(_ type: XCUIAccessibilityAuditType) -> String {
        switch type {
        case .contrast: "contrast"
        case .elementDetection: "elementDetection"
        case .hitRegion: "hitRegion"
        case .sufficientElementDescription: "sufficientElementDescription"
        case .dynamicType: "dynamicType"
        case .textClipped: "textClipped"
        case .trait: "trait"
        default: "other(\(type.rawValue))"
        }
    }

    /// Home, Activity, Add entry, Settings and Insights under one variant. One test per variant
    /// keeps each well inside the plan's time allowance (an audit takes up to 30 seconds).
    @MainActor
    private func auditMainScreens(_ name: String) async throws {
        let variant = try XCTUnwrap(Self.variants.first { $0.name == name })
        var unexpected: [String] = []
        let penny = try await launchDemo(variant)
        unexpected += try audit("home", variant)
        try penny.openActivity()
        unexpected += try audit("activity", variant)
        try penny.openAddEntry()
        unexpected += try audit("add-entry", variant)
        try penny.tap(AccessibilityID.EntryForm.close)
        try penny.waitForAbsence(of: AccessibilityID.Screen.addEntry)
        try penny.openSettings()
        unexpected += try audit("settings", variant)
        try penny.openHome()
        try penny.tap(AccessibilityID.Home.exploreInsights)
        try penny.wait(for: AccessibilityID.Screen.insights)
        unexpected += try audit("insights", variant)
        // Thrown, not asserted: a failed XCTAssert in async UI test code hangs instead of stopping.
        guard unexpected.isEmpty else {
            throw UIExpectationFailed(
                description: "Unreviewed accessibility issues:\n" + unexpected.joined(separator: "\n"))
        }
    }

    @MainActor
    func test_whenAuditingTheMainScreensInLight_AccessibilityAudit_ShouldFindNoUnreviewedIssues() async throws {
        try await auditMainScreens("light")
    }

    @MainActor
    func test_whenAuditingTheMainScreensInDark_AccessibilityAudit_ShouldFindNoUnreviewedIssues() async throws {
        try await auditMainScreens("dark")
    }

    @MainActor
    func test_whenAuditingTheMainScreensAtTheLargestText_AccessibilityAudit_ShouldFindNoUnreviewedIssues()
        async throws
    {
        try await auditMainScreens("xxxl")
    }

    @MainActor
    func test_whenAuditingTheMainScreensInDarkAtTheLargestText_AccessibilityAudit_ShouldFindNoUnreviewedIssues()
        async throws
    {
        try await auditMainScreens("dark-xxxl")
    }

    @MainActor
    func
        test_whenAuditingTheMainScreensWithReducedMotionAndTransparency_AccessibilityAudit_ShouldFindNoUnreviewedIssues()
        async throws
    {
        try await auditMainScreens("reduced")
    }

    /// The signed-out screen, with the keyboard up and an error shown.
    @MainActor
    func test_whenAuditingSignIn_AccessibilityAudit_ShouldFindNoUnreviewedIssues() async throws {
        var unexpected: [String] = []
        for variant in Self.variants where variant.name == "light" || variant.name == "dark-xxxl" {
            XCUIDevice.shared.appearance = variant.appearance
            var options = LaunchOptions()
            options.contentSize = variant.contentSize
            options.seed = ContainerSeed(
                standardDefaults: ["penny.appearance": variant.appearance == .dark ? "dark" : "light"])
            let penny = try await launch(options)
            try penny.wait(for: AccessibilityID.Auth.email)
            unexpected += try audit("sign-in", variant)
            try penny.type("someone@penny.test", into: AccessibilityID.Auth.email)
            try penny.type("wrong-password", into: AccessibilityID.Auth.password)
            // At AX-XXXL the keyboard can cover Sign in; a person scrolls the form, so the test
            // does too (and says so in the results) rather than tapping through the keyboard.
            let signIn = try penny.wait(for: AccessibilityID.Auth.signIn)
            for _ in 0..<3 where !signIn.isHittable {
                app.swipeUp()
            }
            if variant.contentSize != nil { screenshot("sign-in-scrolled-\(variant.name)") }
            signIn.tap()
            try penny.wait(for: AccessibilityID.Auth.error, timeout: 30)
            unexpected += try audit("sign-in-error", variant)
            app.terminate()
        }
        // Thrown, not asserted: a failed XCTAssert in async UI test code hangs instead of stopping.
        guard unexpected.isEmpty else {
            throw UIExpectationFailed(
                description: "Unreviewed accessibility issues:\n" + unexpected.joined(separator: "\n"))
        }
    }

    /// VoiceOver: every button, link, text field and switch on the main screens has a spoken
    /// label (an icon-only control without one reads as "button").
    @MainActor
    func test_whenReadByVoiceOver_InteractiveElements_ShouldAllHaveLabels() async throws {
        let penny = try await launchDemo(Variant(name: "light"))
        var unlabeled: [String] = []
        let interactive: Set<XCUIElement.ElementType> = [.button, .link, .textField, .secureTextField, .switch]
        // One snapshot per screen: querying each element separately costs about a second apiece.
        func check(_ screen: String) throws {
            var pending = [try app.snapshot()]
            while let node = pending.popLast() {
                pending.append(contentsOf: node.children)
                guard interactive.contains(node.elementType), node.isEnabled, !node.frame.isEmpty else { continue }
                if node.label.trimmingCharacters(in: .whitespaces).isEmpty
                    && (node.placeholderValue ?? "").isEmpty
                {
                    unlabeled.append("\(screen): \(node.elementType.rawValue) [\(node.identifier)]")
                }
            }
        }
        try check("home")
        try penny.openActivity()
        try check("activity")
        try penny.openSettings()
        try check("settings")
        try penny.closeSettings()
        try penny.openAddEntry()
        try check("add-entry")
        guard unlabeled.isEmpty else {
            throw UIExpectationFailed(
                description: "Elements without a VoiceOver label:\n" + unlabeled.joined(separator: "\n"))
        }
    }

    /// Keyboard-safe forms: with the keyboard up at the largest accessibility text size, the
    /// focused field and Save stay visible and tappable (the `iphone-add-expense` card's
    /// "keyboard-safe save").
    @MainActor
    func test_whenTheKeyboardIsUpAtTheLargestText_AddEntry_ShouldKeepTheFieldAndSaveReachable() async throws {
        let penny = try await launchDemo(
            Variant(name: "xxxl", contentSize: "UICTContentSizeCategoryAccessibilityXXXL"))
        try penny.openAddEntry()
        let title = try penny.wait(for: AccessibilityID.EntryForm.title)
        title.tap()
        title.typeText("Bakery")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: Penny.timeout), "no keyboard")
        let keyboard = app.keyboards.firstMatch.frame
        XCTAssertLessThanOrEqual(title.frame.maxY, keyboard.minY + 1, "the focused field is under the keyboard")
        XCTAssertTrue(penny.element(AccessibilityID.EntryForm.save).isHittable, "Save is not reachable")
        screenshot("add-entry-keyboard-xxxl")
    }
}
