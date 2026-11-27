import Foundation
import PennyDomain
import Testing

/// Yearly renewals (MAZ-290, phase 2): the Renews soon window and the reminders' dates.
@Suite("Yearly renewals")
struct RenewalTests {
    static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }

    static func rule(
        _ id: String = "prime", frequency: RecurrenceFrequency = .yearly, next: String, active: Bool = true
    ) -> RecurringRule {
        RecurringRule(
            id: id, title: "Amazon Prime", kind: .expense, total: 9_900, share: 9_900, categoryId: "shopping",
            date: day("2025-11-12"), frequency: frequency, nextDate: day(next), anchorDay: day(next).day,
            active: active)
    }

    @Test(
        "whenAYearlyScheduleRenewsWithin7Days_Renewal_ShouldSaySoonWithTheDaysLeft",
        arguments: [
            ("2026-11-12", 3), ("2026-11-09", 0), ("2026-11-16", 7),
        ])
    func soon(next: String, days: Int) {
        #expect(Renewal.daysUntil(Self.rule(next: next), today: Self.day("2026-11-09")) == days)
        #expect(Renewal.isSoon(Self.rule(next: next), today: Self.day("2026-11-09")))
    }

    @Test(
        "whenTheScheduleIsntAnActiveYearlyOneWithin7Days_Renewal_ShouldNotSaySoon",
        arguments: [
            rule(next: "2026-11-17"),
            rule(next: "2026-11-08"),
            rule(next: "2026-11-12", active: false),
            rule(frequency: .monthly, next: "2026-11-12"),
            rule(frequency: .weekly, next: "2026-11-12"),
        ])
    func notSoon(rule: RecurringRule) {
        #expect(Renewal.daysUntil(rule, today: Self.day("2026-11-09")) == nil)
    }

    @Test("whenARemindingYearlyScheduleRenews_RenewalReminder_ShouldCome3DaysBeforeAt9AM")
    func reminder() {
        let reminders = RenewalReminder.upcoming(
            [Self.rule(next: "2027-02-01")], reminding: ["prime"], today: Self.day("2026-11-09"), minutesIntoDay: 600)
        #expect(reminders == [RenewalReminder(ruleID: "prime", renews: Self.day("2027-02-01"), day: Self.day("2027-01-29"))])
        #expect(reminders.first?.identifier == "penny.renewal.prime")
        #expect(RenewalReminder.hour == 9 && RenewalReminder.minute == 0)
    }

    @Test("whenTodayIsTheReminderDay_RenewalReminder_ShouldScheduleItOnlyBefore9AM")
    func reminderDay() {
        let rules = [Self.rule(next: "2026-11-12")]
        let today = Self.day("2026-11-09")
        #expect(
            RenewalReminder.upcoming(rules, reminding: ["prime"], today: today, minutesIntoDay: 8 * 60 + 59).count == 1)
        #expect(RenewalReminder.upcoming(rules, reminding: ["prime"], today: today, minutesIntoDay: 9 * 60).isEmpty)
        #expect(
            RenewalReminder.upcoming(rules, reminding: ["prime"], today: Self.day("2026-11-10"), minutesIntoDay: 0)
                .isEmpty, "inside its last 3 days: none until next year")
    }

    @Test("whenAScheduleIsPausedMonthlyOrNotReminding_RenewalReminder_ShouldScheduleNothing")
    func nothing() {
        let rules = [
            Self.rule("paused", next: "2027-02-01", active: false),
            Self.rule("monthly", frequency: .monthly, next: "2027-02-01"),
            Self.rule("quiet", next: "2027-02-01"),
        ]
        #expect(
            RenewalReminder.upcoming(
                rules, reminding: ["paused", "monthly"], today: Self.day("2026-11-09"), minutesIntoDay: 0
            ).isEmpty)
    }

    @Test("whenManySchedulesRemind_RenewalReminder_ShouldKeepTheSoonestUpToTheLimit")
    func limit() {
        let rules = (0..<50).map { index in
            Self.rule("r\(index)", next: Self.day("2027-01-01").adding(days: 49 - index).description)
        }
        let reminders = RenewalReminder.upcoming(
            rules, reminding: Set(rules.map(\.id)), today: Self.day("2026-11-09"), minutesIntoDay: 0)
        #expect(reminders.count == RenewalReminder.limit)
        #expect(reminders.first?.ruleID == "r49")
        #expect(reminders.map(\.day) == reminders.map(\.day).sorted())
    }

    @Test("whenARenewalNotificationIsOpened_NotificationTarget_ShouldOpenRecurring")
    func target() {
        let target = NotificationTarget(userInfo: ["renewalRule": "prime"])
        #expect(target == .renewal(RenewalNotification(ruleID: "prime")))
        #expect(target?.deepLink == .settings(.recurring))
        #expect(target?.isLocal == true)
        #expect(RenewalNotification(ruleID: "prime").userInfo == ["renewalRule": "prime"])
    }

    @Test("whenARenewalPayloadIsMalformed_NotificationTarget_ShouldBeNone")
    func malformed() {
        let payloads: [[AnyHashable: Any]] = [
            ["renewalRule": ""], ["renewalRule": 3], ["renewalRule": "prime", "recapMonth": "2026-10"],
            ["renewalRule": "prime", "householdId": "maison"], ["renewalRule": String(repeating: "x", count: 101)],
        ]
        for userInfo in payloads {
            #expect(NotificationTarget(userInfo: userInfo) == nil, "\(userInfo)")
        }
    }
}
