/// What a "Your October recap is ready." notification opens (MAZ-292): the recap of that month.
/// It is a local notification Penny schedules itself (Settings › Monthly recap), so its payload is
/// Penny's own: exactly `{recapMonth: "YYYY-MM"}`. It carries no amounts, titles or names, on the
/// Lock Screen or in the payload.
public struct RecapNotification: Equatable, Hashable, Sendable {
    public let month: MonthKey

    public init(month: MonthKey) {
        self.month = month
    }

    /// Reads a notification's `userInfo`. Nil unless it is a valid recap payload; one that also
    /// carries household or receipt keys is not one.
    public init?(userInfo: [AnyHashable: Any]) {
        guard let text = userInfo[Self.key] as? String, let month = MonthKey(text) else { return nil }
        let others = NotificationTarget.householdKeys + [ReceiptInboxNotification.key]
        guard !others.contains(where: { userInfo[$0] != nil }) else { return nil }
        self.month = month
    }

    static let key = "recapMonth"

    /// The payload Penny schedules.
    public var userInfo: [String: String] { [Self.key: month.description] }

    public var deepLink: DeepLink { .recap(month: month) }
}

/// One scheduled "recap is ready" notification: 9:00 local time on the 1st of a month, about the
/// month before it. A repeating trigger can't change its text, so Penny schedules the next
/// occurrences one by one and schedules them again whenever it becomes active.
public struct RecapReminder: Equatable, Hashable, Sendable {
    /// The month the recap is about.
    public let month: MonthKey
    /// The day it is delivered: the 1st of the month after `month`.
    public let day: CalendarDate

    public static let hour = 9
    public static let minute = 0
    /// Every recap notification's identifier starts with this, so they are replaced and removed
    /// together without touching other notifications.
    public static let identifierPrefix = "penny.recap."

    public var identifier: String { Self.identifierPrefix + month.description }

    /// The next `count` reminders after the local date `today` and `minutesIntoDay` (minutes since
    /// local midnight). Today's 9:00 counts while it is still ahead.
    public static func upcoming(today: CalendarDate, minutesIntoDay: Int, count: Int) -> [RecapReminder] {
        let thisMonth = MonthKey(today)
        let stillToday = today.day == 1 && minutesIntoDay < hour * 60 + minute
        guard let first = stillToday ? thisMonth : thisMonth.shifted(by: 1) else { return [] }
        return (0..<max(0, count)).compactMap { offset in
            guard let delivered = first.shifted(by: offset), let recapped = delivered.shifted(by: -1) else {
                return nil
            }
            return RecapReminder(month: recapped, day: delivered.first)
        }
    }
}
