import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("App identity continuity")
struct AppIdentityTests {
    @Test("whenComparedWithLegacyAppJson_AppIdentity_ShouldKeepBundleSchemeAndWidgets")
    func matchesLegacyApp() throws {
        let expo = try #require(try Repository.json("app.json")["expo"] as? [String: Any])
        let ios = try #require(expo["ios"] as? [String: Any])
        #expect(ios["bundleIdentifier"] as? String == AppIdentity.bundleIdentifier)
        #expect(expo["scheme"] as? String == AppIdentity.urlScheme)

        let plugins = try #require(expo["plugins"] as? [Any])
        let widgets = try #require(
            plugins.lazy.compactMap { $0 as? [Any] }.first { $0.first as? String == "expo-widgets" }?.last
                as? [String: Any])
        let kinds = try #require(widgets["widgets"] as? [[String: Any]]).compactMap { $0["name"] as? String }
        #expect(kinds == AppIdentity.widgetKinds)
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

        let workflow = try String(
            contentsOf: Repository.root.appendingPathComponent(".github/workflows/ios-testflight.yml"), encoding: .utf8)
        #expect(workflow.contains("$PENNY_TEAM_ID.\(AppIdentity.bundleIdentifier)"))
    }

    @Test("whenNativePackageBuilds_ContractFixtures_ShouldBeReachable")
    func contractsReachable() throws {
        // MAZ-67 builds the API models on PennyContracts; this keeps the dependency honest.
        let manifest = try Fixtures.decode(FixtureManifest.self, from: "manifest.json")
        #expect(!manifest.fixtures.isEmpty)
    }
}
