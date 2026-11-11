import Foundation

/// State an earlier install left in Penny's containers, applied by the app's Debug test
/// controls before launch (`PENNY_TEST_CONTAINER_SEED`, apps/ios/Penny/TestStorage.swift).
///
/// This is the upgrade-rehearsal hook: MAZ-72 adds a builder for the legacy Expo layout (its
/// App Group files and defaults) and asserts the in-place migration. Seeds hold synthetic
/// `.test` data only.
@MainActor
struct ContainerSeed {
    var standardDefaults: [String: Any] = [:]
    var appGroupDefaults: [String: Any] = [:]
    /// Relative path → contents, inside the App Group container.
    var appGroupFiles: [String: Data] = [:]
    /// Relative path → contents, inside the app's Application Support directory.
    var applicationSupportFiles: [String: Data] = [:]
    var documentsFiles: [String: Data] = [:]

    /// Writes the seed where the app can read it (the runner's temporary directory, which the
    /// simulator app can read by path) and returns its location.
    func write() throws -> URL {
        let plist: [String: Any] = [
            "standardDefaults": standardDefaults, "appGroupDefaults": appGroupDefaults,
            "appGroupFiles": appGroupFiles, "applicationSupportFiles": applicationSupportFiles,
            "documentsFiles": documentsFiles,
        ]
        let url = FileManager.default.temporaryDirectory.appending(path: "penny-seed-\(UUID().uuidString).plist")
        try PropertyListSerialization.data(fromPropertyList: plist, format: .binary, options: 0).write(to: url)
        return url
    }

    /// A previous native install that chose Dark (`penny.appearance`, DevicePreferences).
    static let nativeDarkAppearance = ContainerSeed(standardDefaults: ["penny.appearance": "dark"])
}
