import PennyData
import PennyUI
import SwiftUI

@main
struct PennyApp: App {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>

    init() {
        let configuration = Result { () throws(AppConfiguration.Invalid) in try AppConfiguration.fromMainBundle() }
        #if PENNY_TEST_CONTROLS
            self.configuration = configuration.map(TestControls.fromProcess().apply)
        #else
            self.configuration = configuration
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(configuration: configuration)
        }
    }
}
