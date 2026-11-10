public import Foundation

/// The App Group container the app shares with its widget extension. MAZ-72 migrates the
/// legacy Expo data that lives here; MAZ-80 writes widget snapshots. Both go through this
/// type so the group identifier is checked in one place.
public struct SharedContainer: Sendable {
    public enum Unavailable: Error, Equatable, Sendable {
        /// The build is not signed with the App Group entitlement, or the group is not
        /// registered for this team. Never fall back to the app's private container: the
        /// widgets would silently read stale data.
        case missingEntitlement(String)
    }

    public let appGroup: String
    public let directory: URL
    /// The group's shared defaults. UserDefaults is not Sendable, so it is looked up on use.
    /// `init` already checked the suite exists.
    public var defaults: UserDefaults {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            preconditionFailure("App Group defaults \(appGroup) disappeared after launch.")
        }
        return defaults
    }

    /// `resolve` is FileManager's lookup; tests pass a stub.
    public init(
        appGroup: String,
        resolve: (String) -> URL? = { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
    ) throws(Unavailable) {
        guard let directory = resolve(appGroup), UserDefaults(suiteName: appGroup) != nil else {
            throw .missingEntitlement(appGroup)
        }
        self.appGroup = appGroup
        self.directory = directory
    }
}
