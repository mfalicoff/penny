import PennyData
import PennyDomain
import PennyUI
import Testing

@testable import Penny

// Tests build only in Debug, where PENNY_TEST_CONTROLS is defined. Release exclusion is
// checked on the Release binary by `scripts/ios.sh release-check`.
@Suite("Test controls")
struct TestControlsTests {
    let base = AppConfiguration(environment: .development, defaultServerURL: nil, appGroup: AppIdentity.appGroup)

    @Test("whenServerVariableSet_TestControls_ShouldOverrideTheDefaultServer")
    func override() throws {
        let controls = TestControls.fromProcess(["PENNY_TEST_SERVER_URL": "http://127.0.0.1:5080/"])
        #expect(controls.apply(base).defaultServerURL == (try ServerURL("http://127.0.0.1:5080")))
        #expect(controls.apply(base).environment == base.environment)
    }

    @Test("whenServerVariableInvalidOrMissing_TestControls_ShouldLeaveTheConfigurationAlone")
    func noOverride() {
        #expect(TestControls.fromProcess(["PENNY_TEST_SERVER_URL": "not a url"]).apply(base) == base)
        #expect(TestControls.fromProcess([:]).apply(base) == base)
    }

    @Test("whenDemoVariableSet_TestControls_ShouldOpenTheDemoAtLaunchOnlyForOne")
    @MainActor
    func demo() {
        #expect(TestControls.fromProcess(["PENNY_TEST_DEMO": "1"]).apply(AppServices.live()).startsInDemo)
        #expect(!TestControls.fromProcess(["PENNY_TEST_DEMO": "yes"]).apply(AppServices.live()).startsInDemo)
        #expect(!TestControls.fromProcess([:]).apply(AppServices.live()).startsInDemo)
    }
}
