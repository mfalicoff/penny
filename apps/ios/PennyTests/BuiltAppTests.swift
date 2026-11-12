import Foundation
import PennyData
import PennyDomain
import Testing

/// Checks the app bundle Xcode actually built, so a settings change that breaks upgrade
/// continuity fails here rather than on someone's phone.
@Suite("Built app bundle")
struct BuiltAppTests {
    let info = Bundle.main.infoDictionary ?? [:]

    @Test("whenBuilt_AppBundle_ShouldKeepTheLegacyIdentity")
    func identity() {
        #expect(Bundle.main.bundleIdentifier == AppIdentity.bundleIdentifier)
        #expect(info["CFBundleDisplayName"] as? String == "Penny")
    }

    @Test("whenBuilt_AppBundle_ShouldRegisterThePennyURLScheme")
    func urlScheme() {
        let types = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
        let schemes = types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        #expect(schemes == [AppIdentity.urlScheme])
    }

    @Test("whenBuilt_AppBundle_ShouldTargetIPhoneAndIPadOnIOS26")
    func platforms() {
        #expect(info["MinimumOSVersion"] as? String == "26.0")
        #expect(Set(info["UIDeviceFamily"] as? [Int] ?? []) == [1, 2])
    }

    @Test("whenDebugBuild_AppConfiguration_ShouldBeDevelopmentWithTheLocalServer")
    func configuration() throws {
        let configuration = try AppConfiguration.fromMainBundle()
        #expect(configuration.environment == .development)
        #expect(configuration.defaultServerURL == (try ServerURL("http://localhost:3001")))
        #expect(configuration.appGroup == AppIdentity.appGroup)
    }

    @Test("whenSignedWithEntitlements_SharedContainer_ShouldResolveTheAppGroup")
    func appGroup() throws {
        let container = try SharedContainer(appGroup: AppIdentity.appGroup)
        #expect(FileManager.default.fileExists(atPath: container.directory.path))
    }

    @Test("whenSigned_Entitlements_ShouldRequestAPNsAndKeepTheAppGroup")
    func entitlements() throws {
        // MAZ-79: the checkout's entitlements file, as signed into the build (docs/ios-notifications.md).
        let file = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "Configuration/Penny.entitlements")
        let plist = try #require(
            try PropertyListSerialization.propertyList(from: Data(contentsOf: file), format: nil) as? [String: Any])
        #expect(plist["aps-environment"] as? String == "development")
        #expect(plist["com.apple.security.application-groups"] as? [String] == [AppIdentity.appGroup])
    }

    @Test("whenBuilt_AppBundle_ShouldShipItsPrivacyManifest")
    func privacyManifest() {
        #expect(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy") != nil)
    }
}
