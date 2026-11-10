import PennyData
import PennyUI
import SwiftUI

@main
struct PennyApp: App {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>
    private let services: AppServices

    init() {
        let configuration = Result { () throws(AppConfiguration.Invalid) in try AppConfiguration.fromMainBundle() }
        #if PENNY_TEST_CONTROLS
            let controls = TestControls.fromProcess()
            self.configuration = configuration.map(controls.apply)
            services = controls.apply(AppServices.live())
        #else
            self.configuration = configuration
            services = AppServices.live()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(configuration: configuration, services: services)
        }
    }
}
