import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("App configuration")
struct AppConfigurationTests {
    static var development: [String: Any] {
        [
            "PennyEnvironment": "development",
            "PennyDefaultServerURL": "http://localhost:3001/",
            "PennyAppGroup": "group.com.mfalicoff.penny",
        ]
    }

    @Test("whenDevelopmentInfoPlist_AppConfiguration_ShouldOfferTheLocalServer")
    func development() throws {
        let configuration = try AppConfiguration(infoDictionary: Self.development)
        #expect(configuration.environment == .development)
        #expect(configuration.defaultServerURL == (try ServerURL("http://localhost:3001")))
        #expect(configuration.appGroup == AppIdentity.appGroup)
    }

    @Test("whenProductionInfoPlist_AppConfiguration_ShouldHaveNoDefaultServer")
    func production() throws {
        var info = Self.development
        info["PennyEnvironment"] = "production"
        info["PennyDefaultServerURL"] = ""
        let configuration = try AppConfiguration(infoDictionary: info)
        #expect(configuration.environment == .production)
        #expect(configuration.defaultServerURL == nil)
    }

    @Test(
        "whenSettingMissingOrInvalid_AppConfiguration_ShouldFailInsteadOfFallingBack",
        arguments: [
            ("PennyEnvironment", nil, AppConfiguration.Invalid.missing("PennyEnvironment")),
            ("PennyEnvironment", "staging", .invalidValue("PennyEnvironment")),
            ("PennyDefaultServerURL", "localhost:3001", .invalidValue("PennyDefaultServerURL")),
            ("PennyAppGroup", nil, .missing("PennyAppGroup")),
            ("PennyAppGroup", "", .missing("PennyAppGroup")),
            ("PennyAppGroup", "group.com.example.other", .invalidValue("PennyAppGroup")),
        ] as [(String, String?, AppConfiguration.Invalid)])
    func invalid(key: String, value: String?, expected: AppConfiguration.Invalid) {
        var info = Self.development
        info[key] = value
        #expect(throws: expected) { try AppConfiguration(infoDictionary: info) }
    }

    @Test("whenProductionHasADefaultServer_AppConfiguration_ShouldReject")
    func productionRejectsDefaultServer() {
        var info = Self.development
        info["PennyEnvironment"] = "production"
        #expect(throws: AppConfiguration.Invalid.invalidValue("PennyDefaultServerURL")) {
            try AppConfiguration(infoDictionary: info)
        }
    }
}

@Suite("Shared App Group container")
struct SharedContainerTests {
    @Test("whenEntitlementMissing_SharedContainer_ShouldThrowInsteadOfUsingPrivateStorage")
    func missingEntitlement() {
        #expect(throws: SharedContainer.Unavailable.missingEntitlement(AppIdentity.appGroup)) {
            try SharedContainer(appGroup: AppIdentity.appGroup, resolve: { _ in nil })
        }
    }

    @Test("whenEntitlementPresent_SharedContainer_ShouldUseTheGroupDirectory")
    func resolved() throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        var asked: String?
        let container = try SharedContainer(
            appGroup: AppIdentity.appGroup,
            resolve: {
                asked = $0
                return directory
            })
        #expect(asked == AppIdentity.appGroup)
        #expect(container.directory == directory)
    }
}
