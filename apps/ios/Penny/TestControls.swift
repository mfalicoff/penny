#if PENNY_TEST_CONTROLS
    import Foundation
    import PennyData
    import PennyDomain
    import PennyUI
    import SwiftUI

    /// Launch-time overrides for unit tests and XCUITest (MAZ-81, docs/ios/ui-tests.md).
    /// Compiled only when Debug.xcconfig defines PENNY_TEST_CONTROLS; Release builds contain
    /// none of this, and `scripts/ios.sh release-check` fails if any `PENNY_TEST_` name or
    /// this type's name appears in a Release binary.
    struct TestControls: Equatable {
        /// Environment variable that points the app at a test server, such as the
        /// full-stack test environment (docs/reference/test-environment.md).
        static let serverURLVariable = "PENNY_TEST_SERVER_URL"
        /// Environment variable (`1`) that opens the temporary demo at launch, so UI tests and
        /// screenshots reach the shell without a server (docs/ios/shell.md).
        static let demoVariable = "PENNY_TEST_DEMO"
        /// Environment variable (`1`) that erases everything this app stored on the simulator
        /// before anything reads it: the result is the same as a fresh install (TestStateReset).
        static let resetVariable = "PENNY_TEST_RESET"
        /// Environment variable (`yyyy-MM-dd`) that pins the app's "today", to match the test
        /// server's pinned clock.
        static let todayVariable = "PENNY_TEST_TODAY"
        /// Environment variable (ISO 8601 instant) that pins the app's "now" to the test server's
        /// pinned clock, so "2 min ago" and the month's payment window read as on the server.
        static let nowVariable = "PENNY_TEST_NOW"
        /// Environment variable with the path of a container seed (a property list written by
        /// the UI test, see ContainerSeed), applied after the reset and before launch: the
        /// state an earlier install left, for upgrade rehearsals.
        static let containerSeedVariable = "PENNY_TEST_CONTAINER_SEED"
        /// Environment variables (`1`) that force Reduce Transparency and Reduce Motion for
        /// Penny's own views, for screenshot variants (system controls follow the simulator).
        static let reduceTransparencyVariable = "PENNY_TEST_REDUCE_TRANSPARENCY"
        static let reduceMotionVariable = "PENNY_TEST_REDUCE_MOTION"
        /// Environment variable (`1`) that turns animation off at the root (`UIView` animations and
        /// every SwiftUI transaction), so card captures and screenshots never catch a view mid-way
        /// (MAZ-287, "Tests and captures" in docs/design/motion.md). Journey tests keep motion on.
        static let disableAnimationsVariable = "PENNY_TEST_DISABLE_ANIMATIONS"
        /// Environment variables with a notification payload (JSON, the APNs custom keys) that Penny
        /// handles as if the person had opened that notification (MAZ-79): at launch (a cold start),
        /// or the first time Penny returns from the background (a warm start). It goes through the
        /// same path as a real notification (`PushNotifications.didOpen`); only APNs is skipped.
        static let notificationVariable = "PENNY_TEST_NOTIFICATION"
        static let notificationOnResumeVariable = "PENNY_TEST_NOTIFICATION_ON_RESUME"
        /// Environment variable (`1`) that answers the app lock's Face ID prompts with a stand-in
        /// (`StandInAuthenticator`), because XCUITest cannot enroll or match biometrics. Only the
        /// device check is replaced; the lock itself, its Keychain setting and its rules are real.
        static let deviceAuthVariable = "PENNY_TEST_DEVICE_AUTH"
        /// Environment variable (seconds) for the length of a Lock after minute (MAZ-133), so UI
        /// tests can wait out "After 1 minute" in a few seconds.
        static let lockMinuteVariable = "PENNY_TEST_LOCK_MINUTE"
        /// Environment variable (`light` or `dark`) for what Appearance › System shows, so a card
        /// that shows System selected is captured in dark (the simulator's own appearance does not
        /// reliably reach a freshly launched app).
        static let systemAppearanceVariable = "PENNY_TEST_SYSTEM_APPEARANCE"

        var serverURL: ServerURL?
        var startsInDemo = false
        var resetsState = false
        var today: CalendarDate?
        var now: Date?
        var containerSeed: URL?
        var reduceTransparency = false
        var reduceMotion = false
        var disablesAnimations = false
        var notificationAtLaunch: String?
        var notificationOnResume: String?
        var standInAuthenticator = false
        var lockMinute: Duration?
        var systemAppearance: String?

        static func fromProcess(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> TestControls {
            TestControls(
                serverURL: environment[serverURLVariable].flatMap { try? ServerURL($0) },
                startsInDemo: environment[demoVariable] == "1",
                resetsState: environment[resetVariable] == "1",
                today: environment[todayVariable].flatMap(CalendarDate.init),
                now: environment[nowVariable].flatMap { try? Date($0, strategy: .iso8601) },
                containerSeed: environment[containerSeedVariable].flatMap { $0.isEmpty ? nil : URL(filePath: $0) },
                reduceTransparency: environment[reduceTransparencyVariable] == "1",
                reduceMotion: environment[reduceMotionVariable] == "1",
                disablesAnimations: environment[disableAnimationsVariable] == "1",
                notificationAtLaunch: environment[notificationVariable],
                notificationOnResume: environment[notificationOnResumeVariable],
                standInAuthenticator: environment[deviceAuthVariable] == "1",
                lockMinute: environment[lockMinuteVariable].flatMap { Double($0) }.flatMap {
                    $0 > 0 ? Duration.milliseconds(Int($0 * 1000)) : nil
                },
                systemAppearance: environment[systemAppearanceVariable])
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

        /// The app's pinned now: `PENNY_TEST_NOW`, else noon UTC on the pinned today (the stack's
        /// convention), so a pinned day never decides the month's payment window or "2 min ago" on
        /// the device clock. Nil when neither is pinned.
        var pinnedNow: Date? {
            if let now { return now }
            guard let today else { return nil }
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
            return utc.date(from: DateComponents(year: today.year, month: today.month, day: today.day, hour: 12))
        }

        @MainActor
        func apply(_ services: AppServices) -> AppServices {
            var services = services
            services.startsInDemo = startsInDemo
            if let today { services.today = { today } }
            if let now = pinnedNow { services.now = { now } }
            switch systemAppearance {
            case "dark": services.systemColorScheme = .dark
            case "light": services.systemColorScheme = .light
            default: break
            }
            if standInAuthenticator || lockMinute != nil {
                services.lock = AppLockController(
                    store: KeychainAppLockSettingStore(),
                    authenticator: standInAuthenticator ? StandInAuthenticator() : LocalDeviceAuthenticator(),
                    preferences: services.preferences, minute: lockMinute ?? .seconds(60))
            }
            return services
        }

        /// Face ID for UI tests: turning the lock on or off succeeds, and unlock prompts alternate
        /// between cancelled and success, starting with cancelled. So each time the app locks, its
        /// own prompt is cancelled and the lock screen stays up (a test can see that it locked);
        /// the test's tap on Unlock then succeeds.
        @MainActor
        final class StandInAuthenticator: DeviceAuthenticator {
            let biometry = BiometryKind.faceID
            private var unlocks = 0

            func canEnable() -> AuthenticationResult { .success }

            func authenticate(_ purpose: AuthenticationPurpose, reason: String) async -> AuthenticationResult {
                guard purpose == .unlock else { return .success }
                unlocks += 1
                return unlocks.isMultiple(of: 2) ? .success : .cancelled
            }

            func cancel() {}
        }
    }

    /// Opens the notification TestControls carries, at launch or on the first return from the
    /// background, through `PushNotifications.didOpen` (as the app delegate would).
    struct TestNotificationInjection: ViewModifier {
        let controls: TestControls
        let notifications: PushNotifications
        @Environment(\.scenePhase) private var scenePhase
        @State private var wasInBackground = false
        @State private var resumed = false

        func body(content: Content) -> some View {
            content
                .task {
                    if let json = controls.notificationAtLaunch {
                        notifications.didOpen(target: Self.notification(json))
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { wasInBackground = true }
                    guard phase == .active, wasInBackground, !resumed, let json = controls.notificationOnResume
                    else { return }
                    resumed = true
                    notifications.didOpen(target: Self.notification(json))
                }
        }

        /// The payload as `userInfo`: a household, receipt or recap (MAZ-292) target; nil (a
        /// malformed notification) for anything else.
        static func notification(_ json: String) -> NotificationTarget? {
            guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
                return nil
            }
            return NotificationTarget(userInfo: object as [AnyHashable: Any])
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
                .transaction { transaction in
                    if controls.disablesAnimations { transaction.disablesAnimations = true }
                }
                .onAppear {
                    if controls.disablesAnimations { UIView.setAnimationsEnabled(false) }
                }
        }
    }
#endif
