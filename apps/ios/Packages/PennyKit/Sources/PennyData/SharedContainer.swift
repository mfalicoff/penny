public import Foundation

/// The App Group container the app shares with its widget extension, where MAZ-80 writes
/// widget snapshots. Access goes through this type so the group identifier is checked in one
/// place.
public struct SharedContainer: Sendable {
    public enum Unavailable: Error, Equatable, Sendable {
        /// The build is not signed with the App Group entitlement, or the group is not
        /// registered for this team. Never fall back to the app's private container: the
        /// widgets would silently read stale data.
        case missingEntitlement(String)
    }

    public let appGroup: String
    public let directory: URL
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
