import Foundation

/// What a "New receipt" notification opens (MAZ-184): one item of the receipt inbox. The
/// server's payload is exactly `{inboxItemId, eventId}` (docs/reference/push.md), read from the
/// notification's top-level custom keys. `inboxItemId` follows the same rule as household ids,
/// `[A-Za-z0-9_-]{1,100}`. Opening it shows the item; nothing is ever attached by a tap.
public struct ReceiptInboxNotification: Equatable, Hashable, Sendable {
    public let inboxItemID: String

    public init?(inboxItemID: String) {
        guard HouseholdNotification.isIdentifier(inboxItemID) else { return nil }
        self.inboxItemID = inboxItemID
    }

    /// Reads a notification's `userInfo`. Returns nil unless it is a valid receipt payload; a
    /// payload that also carries household keys is not one.
    public init?(userInfo: [AnyHashable: Any]) {
        guard let item = userInfo[Self.key] as? String else { return nil }
        guard !NotificationTarget.householdKeys.contains(where: { userInfo[$0] != nil }) else { return nil }
        self.init(inboxItemID: item)
    }

    static let key = "inboxItemId"

    public var deepLink: DeepLink { .receiptInbox(itemID: inboxItemID) }
}

/// Every notification Penny opens: a household month or expense (MAZ-79) or a receipt inbox
/// item (MAZ-184). Anything else (a mixture of both shapes, a missing or mistyped key) is no
/// target, and the app just opens.
public enum NotificationTarget: Equatable, Hashable, Sendable {
    case household(HouseholdNotification)
    case receiptInbox(ReceiptInboxNotification)

    static let householdKeys = ["householdId", "month", "expenseId"]

    public init?(userInfo: [AnyHashable: Any]) {
        if userInfo[ReceiptInboxNotification.key] != nil {
            guard let receipt = ReceiptInboxNotification(userInfo: userInfo) else { return nil }
            self = .receiptInbox(receipt)
        } else if let household = HouseholdNotification(userInfo: userInfo) {
            self = .household(household)
        } else {
            return nil
        }
    }

    public var deepLink: DeepLink {
        switch self {
        case .household(let notification): notification.deepLink
        case .receiptInbox(let notification): notification.deepLink
        }
    }
}
