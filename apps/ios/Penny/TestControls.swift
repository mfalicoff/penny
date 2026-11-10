#if PENNY_TEST_CONTROLS
    import Foundation
    import PennyData
    import PennyDomain
    import PennyUI

    /// Launch-time overrides for unit tests and XCUITest (MAZ-81). Compiled only when
    /// Debug.xcconfig defines PENNY_TEST_CONTROLS; Release builds contain none of this, and
    /// `scripts/ios.sh release-check` fails if the marker strings appear in a Release binary.
    struct TestControls: Equatable {
        /// Environment variable that points the app at a test server, such as the
        /// full-stack test environment (docs/migration/test-environment.md).
        static let serverURLVariable = "PENNY_TEST_SERVER_URL"
        /// Environment variable (`1`) that opens the temporary demo at launch, so UI tests and
        /// screenshots reach the shell without a server (docs/ios-shell.md).
        static let demoVariable = "PENNY_TEST_DEMO"

        var serverURL: ServerURL?
        var startsInDemo = false

        static func fromProcess(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> TestControls {
            TestControls(
                serverURL: environment[serverURLVariable].flatMap { try? ServerURL($0) },
                startsInDemo: environment[demoVariable] == "1")
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
            return services
        }
    }
#endif
