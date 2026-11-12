public import Foundation

/// A destination reached from a `penny://` URL. Every legacy Expo Router route keeps one
/// (contracts/design-baseline.json `navigation.legacyRoutes`), so links from the legacy
/// widgets, notifications and the OIDC callback keep working after the native app ships.
/// MAZ-69 maps these onto the shell; this type only decides where a URL points.
public enum DeepLink: Equatable, Sendable {
    case home
    case activity
    case addEntry
    case settings(SettingsPage)
    case households
    case household(id: String)
    case householdExpense(householdID: String, expenseID: String)
    /// A household on a given month, optionally one of that month's expenses (MAZ-79): what a
    /// household notification opens (`HouseholdNotification`), and the legacy notification route
    /// `penny:///households/<id>?month=YYYY-MM&expenseId=<id>`.
    case householdMonth(householdID: String, month: MonthKey, expenseID: String?)
    case trips
    case trip(id: String)
    /// A household invite (MAZ-75): `penny://join?code=<CODE>&server=<server URL>`, from a QR
    /// code or a shared link. The values are kept as sent; `InviteLink(code:server:current:)`
    /// validates them (a malformed link is shown as one, never dropped silently). A query key
    /// that appears twice makes the whole link malformed (both values nil).
    case join(code: String?, server: String?)
    /// The OIDC redirect. Its query (code, state, error) is passed on untouched.
    case authCallback(query: [URLQueryItem])

    public enum SettingsPage: String, Equatable, Sendable, CaseIterable {
        case accounts
        case categories
        case recurring
    }

    /// The URL scheme registered in the app's Info.plist (`CFBundleURLSchemes`) and the
    /// legacy app.json `scheme`.
    public static let scheme = "penny"

    /// Parses a `penny://` URL. Expo Router writes links two ways, and both are accepted:
    /// with an empty host (`penny:///entries/new`) and with the first path segment as
    /// the host (`penny://entries/new`, used by the legacy widget). Returns nil for other
    /// schemes and unknown routes, so a caller can fall back to Home without guessing.
    public init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }

        var segments = components.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if let host = components.host, !host.isEmpty {
            segments.insert(host, at: 0)
        }
        guard let link = Self.route(segments, query: components.queryItems ?? []) else { return nil }
        self = link
    }

    private static func route(_ segments: [String], query: [URLQueryItem]) -> DeepLink? {
        guard segments.allSatisfy(isSafeSegment) else { return nil }
        guard let first = segments.first else { return .home }
        let rest = Array(segments.dropFirst())

        switch (first, rest.count) {
        case ("transactions", 0): return .activity
        case ("entries", 1) where rest[0] == "new": return .addEntry
        case ("households", 0): return .households
        case ("households", 1): return householdLink(rest[0], query)
        case ("households", 3) where rest[1] == "expenses":
            return .householdExpense(householdID: rest[0], expenseID: rest[2])
        case ("trips", 0): return .trips
        case ("trips", 1): return .trip(id: rest[0])
        case ("auth", 1) where rest[0] == "callback": return .authCallback(query: query)
        case ("join", 0): return joinLink(query)
        case (_, 0): return SettingsPage(rawValue: first).map(DeepLink.settings)
        default: return nil
        }
    }

    /// `month` (and `expenseId`) from the legacy notification route. Without a valid month the link
    /// opens the household as before.
    private static func householdLink(_ id: String, _ query: [URLQueryItem]) -> DeepLink {
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        guard let month = value("month"),
            let notification = HouseholdNotification(householdID: id, month: month, expenseID: value("expenseId"))
        else { return .household(id: id) }
        return notification.deepLink
    }

    private static func joinLink(_ query: [URLQueryItem]) -> DeepLink {
        let names = query.map(\.name)
        guard Set(names).count == names.count else { return .join(code: nil, server: nil) }
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        return .join(code: value("code"), server: value("server"))
    }

    /// Identifiers are opaque server ids; reject traversal and empty-looking segments
    /// instead of passing them on to a lookup.
    private static func isSafeSegment(_ segment: String) -> Bool {
        segment != "." && segment != ".." && segment.count <= 128
    }
}
