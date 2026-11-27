/// Yearly renewals (MAZ-290, phase 2): the "Renews soon" tag on Recurring and the opt-in reminder
/// a yearly schedule sends 3 days before it renews.
///
/// Only an active yearly schedule renews: monthly and weekly ones never show the tag or remind,
/// and a paused one does neither until it is resumed. The web shows the same tag
/// (`apps/web/src/features/recurring/model.ts`, `renewsSoon`).
public enum Renewal {
    /// "Renews soon" shows from this many days before the next date, through the day itself.
    public static let soonDays = 7
    /// The reminder comes this many days before the next date (not configurable).
    public static let reminderLeadDays = 3

    /// Days until `rule` renews, while that is within the Renews soon window (0 on the day);
    /// nil for any other schedule or date.
    public static func daysUntil(_ rule: RecurringRule, today: CalendarDate) -> Int? {
        guard rule.active, rule.frequency == .yearly else { return nil }
        let days = rule.nextDate.days(since: today)
        return (0...soonDays).contains(days) ? days : nil
    }

    public static func isSoon(_ rule: RecurringRule, today: CalendarDate) -> Bool {
        daysUntil(rule, today: today) != nil
    }
}

/// What a renewal reminder opens: Recurring, where the schedule wears its Renews soon tag. It is a
/// local notification Penny schedules itself, so its payload is Penny's own:
/// `{renewalRule: "<rule id>"}`. The rule id is an opaque identifier, never a title or an amount.
public struct RenewalNotification: Equatable, Hashable, Sendable {
    public let ruleID: String

    public init(ruleID: String) {
        self.ruleID = ruleID
    }

    /// Reads a notification's `userInfo`. Nil unless it is a valid renewal payload; one that also
    /// carries household, receipt or recap keys is not one.
    public init?(userInfo: [AnyHashable: Any]) {
        guard let id = userInfo[Self.key] as? String, !id.isEmpty, id.count <= 100 else { return nil }
        let others = NotificationTarget.householdKeys + [ReceiptInboxNotification.key, RecapNotification.key]
        guard !others.contains(where: { userInfo[$0] != nil }) else { return nil }
        ruleID = id
    }

    static let key = "renewalRule"

    /// The payload Penny schedules.
    public var userInfo: [String: String] { [Self.key: ruleID] }

    public var deepLink: DeepLink { .settings(.recurring) }
}

/// One scheduled renewal reminder: 9:00 local time, `Renewal.reminderLeadDays` before a yearly
/// schedule's next date. Each schedule has at most one waiting at a time; Penny schedules them
/// again whenever the ledger changes (a materialized occurrence moves the next date a year on, a
/// pause or a removal drops it, an edit moves it).
public struct RenewalReminder: Equatable, Hashable, Sendable {
    public let ruleID: String
    /// The schedule's next date: the day it renews.
    public let renews: CalendarDate
    /// The day it is delivered.
    public let day: CalendarDate

    public static let hour = 9
    public static let minute = 0
    /// Every renewal reminder's identifier starts with this, so they are replaced and removed
    /// together without touching other notifications.
    public static let identifierPrefix = "penny.renewal."
    /// iOS keeps at most 64 pending notifications per app; the monthly recap takes 12.
    public static let limit = 40

    public var identifier: String { Self.identifierPrefix + ruleID }

    /// The reminders to schedule for `rules`: each active yearly schedule in `reminding` whose
    /// reminder is still ahead of the local date `today` and `minutesIntoDay` (today's 9:00 counts
    /// while it is ahead), soonest first, at most `limit`. A schedule already inside its last 3
    /// days gets none until its next year.
    public static func upcoming(
        _ rules: [RecurringRule], reminding: Set<String>, today: CalendarDate, minutesIntoDay: Int
    ) -> [RenewalReminder] {
        let reminders = rules.compactMap { rule -> RenewalReminder? in
            guard reminding.contains(rule.id), rule.active, rule.frequency == .yearly else { return nil }
            let day = rule.nextDate.adding(days: -Renewal.reminderLeadDays)
            let ahead = day > today || (day == today && minutesIntoDay < hour * 60 + minute)
            return ahead ? RenewalReminder(ruleID: rule.id, renews: rule.nextDate, day: day) : nil
        }
        return Array(reminders.sorted { ($0.day, $0.ruleID) < ($1.day, $1.ruleID) }.prefix(limit))
    }
}
