public import Foundation

/// The APNs gateway that issued a device token (MAZ-61/79). The server must send to the same
/// one: a sandbox token sent to production (or the reverse) fails with `BadDeviceToken`.
public enum PushEnvironment: String, Equatable, Sendable, CaseIterable {
    /// Development-signed builds (Xcode, the simulator).
    case sandbox
    /// Distribution-signed builds (TestFlight, the App Store, ad hoc).
    case production
}

/// An APNs device token as the server stores it: lower-case hex, 32–100 bytes (Apple documents
/// tokens as variable length; today they are 32). It is not a secret, but it is never logged:
/// `description` is redacted.
public struct PushDeviceToken: Hashable, Sendable, CustomStringConvertible {
    public let hex: String

    public static let byteRange = 32...100

    public init?(_ data: Data) {
        guard Self.byteRange.contains(data.count) else { return nil }
        hex = data.map { String(format: "%02x", $0) }.joined()
    }

    /// Accepts the server's pattern (`([0-9A-Fa-f]{2}){32,100}`) and stores it lower-case.
    public init?(hex text: String) {
        let utf8 = text.utf8
        guard utf8.count.isMultiple(of: 2), Self.byteRange.contains(utf8.count / 2),
            utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 70) || ($0 >= 97 && $0 <= 102) })
        else { return nil }
        hex = text.lowercased()
    }

    public var description: String { "PushDeviceToken(redacted)" }
}

/// What a household notification opens (MAZ-79): the server's allowlisted deep-link payload
/// (docs/reference/push.md), read from the notification's top-level custom keys.
///
/// The rules: `householdId` and an optional
/// `expenseId` are `[A-Za-z0-9_-]{1,100}`, `month` is `YYYY-MM`. Anything else (a missing or
/// mistyped key, a URL, extra path segments) makes the whole payload invalid, so a notification
/// can never navigate anywhere but a household month or one of its expenses. `eventId` and
/// unknown keys are ignored.
public struct HouseholdNotification: Equatable, Hashable, Sendable {
    public let householdID: String
    public let month: MonthKey
    public let expenseID: String?

    public init?(householdID: String, month: String, expenseID: String? = nil) {
        guard Self.isIdentifier(householdID), Self.isMonth(month), let key = MonthKey(month) else { return nil }
        if let expenseID, !Self.isIdentifier(expenseID) { return nil }
        self.householdID = householdID
        self.month = key
        self.expenseID = expenseID
    }

    /// Reads a notification's `userInfo` (`UNNotificationContent.userInfo`). Returns nil for
    /// anything but a valid household payload.
    public init?(userInfo: [AnyHashable: Any]) {
        guard let household = userInfo["householdId"] as? String, let month = userInfo["month"] as? String
        else { return nil }
        let expense = userInfo["expenseId"]
        if expense != nil, !(expense is String) { return nil }
        self.init(householdID: household, month: month, expenseID: expense as? String)
    }

    /// Where it opens: the household on that month, or that month's expense.
    public var deepLink: DeepLink { .householdMonth(householdID: householdID, month: month, expenseID: expenseID) }

    static func isIdentifier(_ text: String) -> Bool {
        let utf8 = text.utf8
        return (1...100).contains(utf8.count)
            && utf8.allSatisfy {
                ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95
            }
    }

    /// `^\d{4}-(0[1-9]|1[0-2])$`, ASCII digits only.
    static func isMonth(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard bytes.count == 7, bytes[4] == 45 else { return false }
        return bytes.enumerated().allSatisfy { $0.offset == 4 || ($0.element >= 48 && $0.element <= 57) }
    }
}
