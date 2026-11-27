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

/// Every notification Penny opens: a household month or expense (MAZ-79), a receipt inbox
/// item (MAZ-184), a monthly recap (MAZ-292) or a renewal reminder (MAZ-290). Anything else (a mixture of shapes, a missing or
/// mistyped key) is no target, and the app just opens.
public enum NotificationTarget: Equatable, Hashable, Sendable {
    case household(HouseholdNotification)
    case receiptInbox(ReceiptInboxNotification)
    /// A monthly recap is ready (MAZ-292): a local notification Penny scheduled itself.
    case recap(RecapNotification)
    /// A yearly schedule renews in 3 days (MAZ-290): a local notification Penny scheduled itself.
    case renewal(RenewalNotification)

    static let householdKeys = ["householdId", "month", "expenseId"]

    public init?(userInfo: [AnyHashable: Any]) {
        if userInfo[RenewalNotification.key] != nil {
            guard let renewal = RenewalNotification(userInfo: userInfo) else { return nil }
            self = .renewal(renewal)
        } else if userInfo[RecapNotification.key] != nil {
            guard let recap = RecapNotification(userInfo: userInfo) else { return nil }
            self = .recap(recap)
        } else if userInfo[ReceiptInboxNotification.key] != nil {
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
        case .recap(let notification): notification.deepLink
        case .renewal(let notification): notification.deepLink
        }
    }

    /// A notification Penny scheduled on this device (the monthly recap, a renewal reminder), not
    /// one APNs delivered for the device's push registration.
    public var isLocal: Bool {
        switch self {
        case .recap, .renewal: true
        case .household, .receiptInbox: false
        }
    }
}
