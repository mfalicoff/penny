import PennyData
import PennyUI
import SwiftUI

@main
struct PennyApp: App {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>
    private let services: AppServices
    /// APNs and notification callbacks (MAZ-79, PennyUI.PushNotifications).
    @UIApplicationDelegateAdaptor(PennyAppDelegate.self) private var appDelegate
    #if PENNY_TEST_CONTROLS
        private let controls = TestControls.fromProcess()
    #endif

    init() {
        let configuration = Result { () throws(AppConfiguration.Invalid) in try AppConfiguration.fromMainBundle() }
        #if PENNY_TEST_CONTROLS
            if case .success(let loaded) = configuration {
                do {
                    try controls.prepareStorage(appGroup: loaded.appGroup)
                } catch {
                    preconditionFailure("Test controls could not prepare storage: \(error)")
                }
            }
            self.configuration = configuration.map(controls.apply)
            services = controls.apply(AppServices.live())
        #else
            self.configuration = configuration
            services = AppServices.live()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            #if PENNY_TEST_CONTROLS
                RootView(configuration: configuration, services: services, notifications: appDelegate.notifications)
                    .modifier(TestAccessibilityOverrides(controls: controls))
                    .modifier(TestNotificationInjection(controls: controls, notifications: appDelegate.notifications))
            #else
                RootView(configuration: configuration, services: services, notifications: appDelegate.notifications)
            #endif
        }
    }
}
