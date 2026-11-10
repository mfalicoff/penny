import Foundation
public import PennyDomain

/// Build-time settings, read from the app's Info.plist. The values come from
/// apps/ios/Configuration/*.xcconfig, so Debug and Release differ only there.
public struct AppConfiguration: Equatable, Sendable {
    public enum Environment: String, Equatable, Sendable {
        /// Debug builds: a local default server and the test controls.
        case development
        /// Release builds (TestFlight and the App Store): no default server, no test controls.
        case production
    }

    public enum Key {
        public static let environment = "PennyEnvironment"
        public static let defaultServerURL = "PennyDefaultServerURL"
        public static let appGroup = "PennyAppGroup"
    }

    public enum Invalid: Error, Equatable, Sendable {
        case missing(String)
        case invalidValue(String)
    }

    public let environment: Environment
    /// The server offered before one is chosen. Nil in production, where people enter
    /// their own self-hosted server (MAZ-68).
    public let defaultServerURL: ServerURL?
    public let appGroup: String

    public init(environment: Environment, defaultServerURL: ServerURL?, appGroup: String) {
        self.environment = environment
        self.defaultServerURL = defaultServerURL
        self.appGroup = appGroup
    }

    /// Fails instead of falling back: a build with a missing or malformed setting is a
    /// configuration mistake that should stop at launch in development and in tests.
    public init(infoDictionary info: [String: Any]) throws(Invalid) {
        guard let rawEnvironment = info[Key.environment] as? String else { throw .missing(Key.environment) }
        guard let environment = Environment(rawValue: rawEnvironment) else { throw .invalidValue(Key.environment) }

        let rawServer = (info[Key.defaultServerURL] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let server: ServerURL?
        if rawServer.isEmpty {
            server = nil
        } else {
            do { server = try ServerURL(rawServer) } catch { throw .invalidValue(Key.defaultServerURL) }
        }
        if environment == .production, server != nil { throw .invalidValue(Key.defaultServerURL) }

        guard let appGroup = info[Key.appGroup] as? String, !appGroup.isEmpty else { throw .missing(Key.appGroup) }
        guard appGroup == AppIdentity.appGroup else { throw .invalidValue(Key.appGroup) }

        self.init(environment: environment, defaultServerURL: server, appGroup: appGroup)
    }

    public static func fromMainBundle() throws(Invalid) -> AppConfiguration {
        try AppConfiguration(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }
}
