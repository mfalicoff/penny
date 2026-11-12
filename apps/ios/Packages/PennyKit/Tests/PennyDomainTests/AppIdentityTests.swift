import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("App identity continuity")
struct AppIdentityTests {
    // The Expo app and its app.json are gone (MAZ-98). These are the values its released builds
    // (1.0.0 and later) shipped with; installs only upgrade in place while the native app keeps them.
    @Test("whenComparedWithReleasedExpoApp_AppIdentity_ShouldKeepBundleSchemeAndWidgets")
    func matchesReleasedExpoApp() {
        #expect(AppIdentity.bundleIdentifier == "com.mfalicoff.penny")
        #expect(AppIdentity.urlScheme == "penny")
        #expect(AppIdentity.appGroup == "group.com.mfalicoff.penny")
        #expect(AppIdentity.widgetExtensionBundleIdentifier == "com.mfalicoff.penny.ExpoWidgetsTarget")
        #expect(AppIdentity.widgetKinds == ["BalanceChartWidget", "RecentExpensesWidget"])
    }

    @Test("whenComparedWithSigningDocs_AppIdentity_ShouldKeepAppGroupAndWidgetId")
    func matchesSigningDocs() throws {
        let doc = try String(contentsOf: Repository.root.appendingPathComponent("docs/ios-ipa.md"), encoding: .utf8)
        #expect(doc.contains(AppIdentity.appGroup))
        #expect(doc.contains(AppIdentity.widgetExtensionBundleIdentifier))
        #expect(AppIdentity.widgetExtensionBundleIdentifier.hasPrefix(AppIdentity.bundleIdentifier + "."))
    }

    // MAZ-98: the TestFlight checks in ios.sh refuse any archive or IPA that is not this app.
    // If they drifted from AppIdentity, they would pass a build that cannot upgrade Expo installs.
    @Test("whenComparedWithReleaseScript_AppIdentity_ShouldMatchTheTestFlightChecks")
    func matchesReleaseScript() throws {
        let script = try String(
            contentsOf: Repository.root.appendingPathComponent("apps/ios/scripts/ios.sh"), encoding: .utf8)
        #expect(script.contains("BUNDLE_ID=\"\(AppIdentity.bundleIdentifier)\""))
        #expect(script.contains("APP_GROUP=\"\(AppIdentity.appGroup)\""))
        #expect(script.contains("WIDGETS_ID=\"\(AppIdentity.widgetExtensionBundleIdentifier)\""))

        let workflow = try String(
            contentsOf: Repository.root.appendingPathComponent(".github/workflows/ios-testflight.yml"), encoding: .utf8)
        // CI installs one App Store profile per signed bundle and checks each is for that id.
        #expect(workflow.contains("\"$APPSTORE_PROFILE\" \(AppIdentity.bundleIdentifier))"))
        #expect(workflow.contains("\"$WIDGETS_APPSTORE_PROFILE\" \(AppIdentity.widgetExtensionBundleIdentifier))"))
    }

    @Test("whenNativePackageBuilds_ContractFixtures_ShouldBeReachable")
    func contractsReachable() throws {
        // MAZ-67 builds the API models on PennyContracts; this keeps the dependency honest.
        let manifest = try Fixtures.decode(FixtureManifest.self, from: "manifest.json")
        #expect(!manifest.fixtures.isEmpty)
    }
}
