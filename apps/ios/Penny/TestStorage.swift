#if PENNY_TEST_CONTROLS
    import Foundation
    import PennyData
    import Security

    /// Erases what Penny stores on a simulator, so one app install can run many UI tests that
    /// each start like a fresh install (MAZ-81). Debug only (TestControls).
    enum TestStateReset {
        static func eraseEverything(appGroup: String, fileManager: FileManager = .default) {
            if let bundle = Bundle.main.bundleIdentifier {
                UserDefaults.standard.removePersistentDomain(forName: bundle)
            }
            UserDefaults(suiteName: appGroup)?.removePersistentDomain(forName: appGroup)
            // Generic passwords hold the sessions and the lock setting (SessionStore,
            // AppLockSettingStore). The app's first launch also clears them; this does it
            // before anything can read them.
            SecItemDelete([kSecClass as String: kSecClassGenericPassword] as CFDictionary)
            for directory in [URL.applicationSupportDirectory, URL.documentsDirectory, URL.cachesDirectory] {
                empty(directory, keeping: [], fileManager: fileManager)
            }
            if let group = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
                // The group's Library/Preferences belongs to the defaults cleared above.
                empty(group, keeping: ["Library"], fileManager: fileManager)
                empty(group.appending(path: "Library"), keeping: ["Preferences"], fileManager: fileManager)
            }
        }

        private static func empty(_ directory: URL, keeping kept: Set<String>, fileManager: FileManager) {
            let items = (try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for item in items where !kept.contains(item.lastPathComponent) { try? fileManager.removeItem(at: item) }
        }
    }

    /// The stored state an earlier install left behind, written by a UI test as a property list
    /// and applied before launch (`PENNY_TEST_CONTAINER_SEED`), for upgrade rehearsals.
    ///
    /// Keys (all optional):
    /// - `standardDefaults`, `appGroupDefaults`: dictionaries written into UserDefaults.
    /// - `appGroupFiles`, `applicationSupportFiles`, `documentsFiles`: relative path → Data.
    enum ContainerSeed {
        enum Invalid: Error { case notADictionary, unsafePath(String) }

        static func apply(contentsOf url: URL, appGroup: String, fileManager: FileManager = .default) throws {
            let data = try Data(contentsOf: url)
            guard let seed = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
            else { throw Invalid.notADictionary }
            if let values = seed["standardDefaults"] as? [String: Any] {
                for (key, value) in values { UserDefaults.standard.set(value, forKey: key) }
            }
            if let values = seed["appGroupDefaults"] as? [String: Any], let defaults = UserDefaults(suiteName: appGroup)
            {
                for (key, value) in values { defaults.set(value, forKey: key) }
            }
            let roots: [(String, URL?)] = [
                ("appGroupFiles", fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup)),
                ("applicationSupportFiles", URL.applicationSupportDirectory),
                ("documentsFiles", URL.documentsDirectory),
            ]
            for (key, root) in roots {
                guard let files = seed[key] as? [String: Data], let root else { continue }
                for (path, contents) in files {
                    guard !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else {
                        throw Invalid.unsafePath(path)
                    }
                    let file = root.appending(path: path)
                    try fileManager.createDirectory(
                        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try contents.write(to: file, options: .atomic)
                }
            }
        }
    }
#endif
