import Foundation
import PennyAccessibility
import XCTest

/// How a test launches Penny. Each value maps to a Debug-only test control
/// (`apps/ios/Penny/TestControls.swift`) or a system launch argument; nothing replaces the
/// app's networking or storage.
@MainActor
struct LaunchOptions {
    /// Erase everything the app stored, so the launch behaves like a fresh install. The first
    /// launch of every test does this; `relaunch()` does not.
    var resetsState = true
    /// Point the app at the stack (the default), or at no server (the demo).
    var usesStack = true
    /// Open the temporary demo (no server).
    var demo = false
    /// The app's "today" (`yyyy-MM-dd`), matching the server clock.
    var today: String? = Stack.defaultToday
    /// State an earlier install left (upgrade rehearsals).
    var seed: ContainerSeed?
    /// A `UIContentSizeCategory` raw value, such as `UICTContentSizeCategoryAccessibilityXL`.
    var contentSize: String?
    var reduceTransparency = false
    var reduceMotion = false
    /// A notification payload (JSON) Penny opens as if tapped: at launch, or the first time it
    /// returns from the background (MAZ-79, `PENNY_TEST_NOTIFICATION*`).
    var notification: String?
    var notificationOnResume: String?
}

/// Base class for Penny's UI tests: launches against the full-stack environment, creates
/// isolated accounts, and captures screenshots and the accessibility tree.
///
/// Test methods are `@MainActor` and named `test_whenCondition_Subject_ShouldOutcome`: the
/// repository's Swift Testing convention with the `test` prefix XCTest needs (Swift Testing
/// cannot drive XCUIApplication).
class PennyUITestCase: XCTestCase {
    static let bundleIdentifier = "com.mfalicoff.penny"

    /// Per-test state, kept outside the instance: XCTestCase's initializers are nonisolated,
    /// and main-actor stored properties would need main-actor initializers.
    @MainActor
    private final class State {
        var current: XCUIApplication?
        var lastOptions: LaunchOptions?
        var stack: Stack?
    }
    @MainActor private static var states: [ObjectIdentifier: State] = [:]

    @MainActor private var state: State {
        if let state = Self.states[ObjectIdentifier(self)] { return state }
        let state = State()
        Self.states[ObjectIdentifier(self)] = state
        return state
    }

    /// The app under test (the one the last `launch` started).
    @MainActor var app: XCUIApplication {
        state.current ?? XCUIApplication(bundleIdentifier: Self.bundleIdentifier)
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDown() async throws {
        // Faults are global to the stack; never leave one behind for the next test.
        let key = ObjectIdentifier(self)
        try? await MainActor.run {
            Self.states.removeValue(forKey: key)?.stack
        }?.clearFaults()
        try await super.tearDown()
    }

    /// The stack, or a skip when none is running. `scripts/ios.sh ui-test` sets
    /// `PENNY_UITEST_REQUIRE_STACK=1`, which turns a missing stack into a failure.
    @MainActor
    func stack() async throws -> Stack {
        if let stack = state.stack { return stack }
        guard let configuration = StackConfiguration.load() else {
            if ProcessInfo.processInfo.environment["PENNY_UITEST_REQUIRE_STACK"] == "1" {
                XCTFail("No full-stack environment: run through `apps/ios/scripts/ios.sh ui-test`.")
            }
            throw XCTSkip("No full-stack environment. Start one with `npm run test-env -- up --oidc`.")
        }
        let stack = Stack(configuration: configuration)
        try await stack.setClock(Stack.defaultNow)
        // A test that hit its time allowance never ran tearDown; start without its faults.
        try await stack.clearFaults()
        state.stack = stack
        return stack
    }

    /// A fresh account on the stack: a unique `.test` email, so tests never share data.
    @MainActor
    func makeAccount(_ label: String = "ui") async throws -> TestAccount {
        try await stack().createAccount(label: label)
    }

    // MARK: Launching

    @MainActor @discardableResult
    func launch(_ options: LaunchOptions = LaunchOptions()) async throws -> Penny {
        state.lastOptions = options
        let app = XCUIApplication(bundleIdentifier: Self.bundleIdentifier)
        state.current = app
        var environment: [String: String] = [:]
        if options.resetsState { environment["PENNY_TEST_RESET"] = "1" }
        if options.usesStack {
            environment["PENNY_TEST_SERVER_URL"] = try await stack().configuration.apiURL.absoluteString
        }
        if options.demo { environment["PENNY_TEST_DEMO"] = "1" }
        if let today = options.today { environment["PENNY_TEST_TODAY"] = today }
        if options.reduceTransparency { environment["PENNY_TEST_REDUCE_TRANSPARENCY"] = "1" }
        if options.reduceMotion { environment["PENNY_TEST_REDUCE_MOTION"] = "1" }
        if let notification = options.notification { environment["PENNY_TEST_NOTIFICATION"] = notification }
        if let notification = options.notificationOnResume {
            environment["PENNY_TEST_NOTIFICATION_ON_RESUME"] = notification
        }
        if let seed = options.seed { environment["PENNY_TEST_CONTAINER_SEED"] = try seed.write().path() }
        app.launchEnvironment = environment
        app.launchArguments = options.contentSize.map { ["-UIPreferredContentSizeCategoryName", $0] } ?? []
        app.launch()
        let penny = Penny(app: app)
        try penny.wait(for: AccessibilityID.Root.launch, timeout: 30)
        return penny
    }

    /// Terminates Penny and launches it again with the same options, keeping its stored state
    /// (the session in the Keychain, the offline ledger and preferences).
    @MainActor @discardableResult
    func relaunch() async throws -> Penny {
        app.terminate()
        var options = state.lastOptions ?? LaunchOptions()
        options.resetsState = false
        options.seed = nil
        return try await launch(options)
    }

    // MARK: Artifacts

    /// Attaches a screenshot of the whole screen, kept even when the test passes. Names
    /// include the device and appearance so a plan's screenshots sort together.
    @MainActor
    func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(Device.name)-\(Device.appearanceName)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // Failure diagnostics: XCTest itself attaches the screenshot, the screen recording and the
    // app's accessibility hierarchy to a failing UI test ("Collecting debug information to
    // assist test failure triage"). Snapshotting the app again from `record(_:)` deadlocks
    // async tests, so this class adds nothing there.
}

/// The simulator the runner is on.
@MainActor
enum Device {
    static var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    static var name: String { isPad ? "ipad" : "iphone" }
    static var appearanceName: String { XCUIDevice.shared.appearance == .dark ? "dark" : "light" }
}
