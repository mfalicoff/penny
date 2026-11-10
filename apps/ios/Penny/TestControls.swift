#if PENNY_TEST_CONTROLS
    import Foundation
    import PennyData
    import PennyDomain
    import PennyUI
    import SwiftUI

    /// Launch-time overrides for unit tests and XCUITest (MAZ-81, docs/ios-ui-tests.md).
    /// Compiled only when Debug.xcconfig defines PENNY_TEST_CONTROLS; Release builds contain
    /// none of this, and `scripts/ios.sh release-check` fails if any `PENNY_TEST_` name or
    /// this type's name appears in a Release binary.
    struct TestControls: Equatable {
        /// Environment variable that points the app at a test server, such as the
        /// full-stack test environment (docs/migration/test-environment.md).
        static let serverURLVariable = "PENNY_TEST_SERVER_URL"
        /// Environment variable (`1`) that opens the temporary demo at launch, so UI tests and
        /// screenshots reach the shell without a server (docs/ios-shell.md).
        static let demoVariable = "PENNY_TEST_DEMO"
        /// Environment variable (`1`) that erases everything this app stored on the simulator
        /// before anything reads it: the result is the same as a fresh install (TestStateReset).
        static let resetVariable = "PENNY_TEST_RESET"
        /// Environment variable (`yyyy-MM-dd`) that pins the app's "today", to match the test
        /// server's pinned clock.
        static let todayVariable = "PENNY_TEST_TODAY"
        /// Environment variable with the path of a container seed (a property list written by
        /// the UI test, see ContainerSeed), applied after the reset and before launch: the
        /// state an earlier install left, for upgrade rehearsals (MAZ-72).
        static let containerSeedVariable = "PENNY_TEST_CONTAINER_SEED"
        /// Environment variables (`1`) that force Reduce Transparency and Reduce Motion for
        /// Penny's own views, for screenshot variants (system controls follow the simulator).
        static let reduceTransparencyVariable = "PENNY_TEST_REDUCE_TRANSPARENCY"
        static let reduceMotionVariable = "PENNY_TEST_REDUCE_MOTION"

        var serverURL: ServerURL?
        var startsInDemo = false
        var resetsState = false
        var today: CalendarDate?
        var containerSeed: URL?
        var reduceTransparency = false
        var reduceMotion = false

        static func fromProcess(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> TestControls {
            TestControls(
                serverURL: environment[serverURLVariable].flatMap { try? ServerURL($0) },
                startsInDemo: environment[demoVariable] == "1",
                resetsState: environment[resetVariable] == "1",
                today: environment[todayVariable].flatMap(CalendarDate.init),
                containerSeed: environment[containerSeedVariable].flatMap { $0.isEmpty ? nil : URL(filePath: $0) },
                reduceTransparency: environment[reduceTransparencyVariable] == "1",
                reduceMotion: environment[reduceMotionVariable] == "1")
        }

        /// Runs before the app reads any stored state: the reset, then the seed.
        func prepareStorage(appGroup: String) throws {
            if resetsState { TestStateReset.eraseEverything(appGroup: appGroup) }
            if let containerSeed { try ContainerSeed.apply(contentsOf: containerSeed, appGroup: appGroup) }
        }

        func apply(_ configuration: AppConfiguration) -> AppConfiguration {
            guard let serverURL else { return configuration }
            return AppConfiguration(
                environment: configuration.environment, defaultServerURL: serverURL, appGroup: configuration.appGroup)
        }

        @MainActor
        func apply(_ services: AppServices) -> AppServices {
            var services = services
            services.startsInDemo = startsInDemo
            if let today { services.today = { today } }
            return services
        }
    }

    /// Forces the accessibility settings TestControls asks for on Penny's own views.
    struct TestAccessibilityOverrides: ViewModifier {
        let controls: TestControls

        func body(content: Content) -> some View {
            content
                .transformEnvironment(\._accessibilityReduceTransparency) { value in
                    value = value || controls.reduceTransparency
                }
                .transformEnvironment(\._accessibilityReduceMotion) { value in
                    value = value || controls.reduceMotion
                }
        }
    }
#endif
