import Foundation
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

@Suite("UI test launch controls")
struct UITestLaunchControlsTests {
    @Test("whenTodayVariableSet_TestControls_ShouldPinTheAppsToday")
    @MainActor
    func today() throws {
        let controls = TestControls.fromProcess(["PENNY_TEST_TODAY": "2026-10-15"])
        #expect(controls.today == CalendarDate(year: 2026, month: 10, day: 15))
        #expect(controls.apply(AppServices.live()).today() == CalendarDate(year: 2026, month: 10, day: 15))
        #expect(TestControls.fromProcess(["PENNY_TEST_TODAY": "15/10/2026"]).today == nil)
        #expect(TestControls.fromProcess(["PENNY_TEST_TODAY": "2026-02-30"]).today == nil)
    }

    @Test("whenFlagsSet_TestControls_ShouldReadOnlyTheExactValueOne")
    func flags() {
        let on = TestControls.fromProcess([
            "PENNY_TEST_RESET": "1", "PENNY_TEST_REDUCE_TRANSPARENCY": "1", "PENNY_TEST_REDUCE_MOTION": "1",
        ])
        #expect(on.resetsState && on.reduceTransparency && on.reduceMotion)
        let off = TestControls.fromProcess([
            "PENNY_TEST_RESET": "true", "PENNY_TEST_REDUCE_TRANSPARENCY": "yes", "PENNY_TEST_REDUCE_MOTION": "",
        ])
        #expect(!off.resetsState && !off.reduceTransparency && !off.reduceMotion)
        #expect(TestControls.fromProcess([:]) == TestControls())
    }

    @Test("whenSeedApplied_ContainerSeed_ShouldWriteDefaultsAndFilesInsideTheContainer")
    func seed() throws {
        let key = "penny.uitest.seed.\(UUID().uuidString)"
        let file = "UITestSeed-\(UUID().uuidString)/note.txt"
        let seed: [String: Any] = [
            "standardDefaults": [key: "standard"],
            "applicationSupportFiles": [file: Data("seeded".utf8)],
        ]
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).plist")
        try PropertyListSerialization.data(fromPropertyList: seed, format: .binary, options: 0).write(to: url)
        defer {
            UserDefaults.standard.removeObject(forKey: key)
            try? FileManager.default.removeItem(
                at: URL.applicationSupportDirectory.appending(path: file).deletingLastPathComponent())
            try? FileManager.default.removeItem(at: url)
        }

        try ContainerSeed.apply(contentsOf: url, appGroup: AppIdentity.appGroup)

        #expect(UserDefaults.standard.string(forKey: key) == "standard")
        let written = try Data(contentsOf: URL.applicationSupportDirectory.appending(path: file))
        #expect(String(decoding: written, as: UTF8.self) == "seeded")
    }

    @Test("whenSeedPathEscapesTheContainer_ContainerSeed_ShouldRefuseIt")
    func unsafeSeed() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).plist")
        let seed: [String: Any] = ["documentsFiles": ["../outside.txt": Data()]]
        try PropertyListSerialization.data(fromPropertyList: seed, format: .binary, options: 0).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(throws: ContainerSeed.Invalid.self) {
            try ContainerSeed.apply(contentsOf: url, appGroup: AppIdentity.appGroup)
        }
    }
}
