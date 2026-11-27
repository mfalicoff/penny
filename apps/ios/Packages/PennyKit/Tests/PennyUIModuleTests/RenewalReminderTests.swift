import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

/// A notification center that records what renewal reminders ask of it.
actor FakeRenewalCenter: RenewalNotificationCenter {
    var current: PushPermission
    let answer: Bool
    private(set) var prompts = 0
    private(set) var pending: [String: (reminder: RenewalReminder, text: RenewalText.Notification)] = [:]
    /// Someone else's notification (the monthly recap's), which must never be removed.
    let other = "penny.recap.2026-10"

    init(permission: PushPermission, answer: Bool = true) {
        current = permission
        self.answer = answer
    }

    func permission() async -> PushPermission { current }

    func requestPermission() async -> Bool {
        prompts += 1
        current = answer ? .allowed : .denied
        return answer
    }

    func pendingIdentifiers() async -> [String] { Array(pending.keys) + [other] }

    func schedule(_ reminder: RenewalReminder, text: RenewalText.Notification) async throws {
        pending[reminder.identifier] = (reminder, text)
    }

    func removePending(_ identifiers: [String]) async {
        #expect(!identifiers.contains(other), "only renewal reminders are removed")
        for id in identifiers { pending[id] = nil }
    }

    func revoke() { current = .denied }

    var days: [String: CalendarDate] { pending.mapValues(\.reminder.day) }
    var texts: [RenewalText.Notification] { pending.values.map(\.text) }
}

@Suite("Renewal reminders in the app")
@MainActor
struct RenewalReminderTests {
    static let owner = WidgetPublisher.Owner.account("owner-a")

    static func day(_ text: String) -> CalendarDate { CalendarDate(text) ?? .earliest }

    /// 2026-11-09 at 10:00 in Toronto.
    static func now() throws -> (Date, Calendar) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Toronto"))
        let date = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 9, hour: 10)))
        return (date, calendar)
    }

    static func ledger(next: String = "2027-02-01", active: Bool = true, frequency: RecurrenceFrequency = .yearly)
        -> Ledger
    {
        Ledger(
            currency: .usd,
            recurring: [
                RecurringRule(
                    id: "domain", title: "Domain name", kind: .expense, total: 2_400, share: 2_400,
                    categoryId: "other", date: day("2025-02-01"), frequency: frequency, nextDate: day(next),
                    anchorDay: day(next).day, active: active)
            ])
    }

    static func defaults() throws -> UserDefaults {
        let name = "penny.tests.renewal.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    private func apply(_ renewals: RenewalReminders, _ ledger: Ledger) async throws {
        let (now, calendar) = try Self.now()
        let plan = renewals.plan(ledger, now: now, calendar: calendar, locale: Locale(identifier: "en_US"))
        await renewals.apply(plan, ruleIDs: Set(ledger.recurring.map(\.id)))
    }

    @Test("whenTurnedOnTheFirstTime_RenewalReminders_ShouldAskPermissionAndRemind3DaysBefore")
    func turnOn() async throws {
        let center = FakeRenewalCenter(permission: .notDetermined)
        let defaults = try Self.defaults()
        let renewals = RenewalReminders(defaults: defaults, center: center)
        await renewals.ownerChanged(Self.owner)
        #expect(renewals.offersReminders)
        #expect(!renewals.reminds("domain"), "off until turned on")
        #expect(!renewals.showsDetails("domain"), "private by default")
        await renewals.setReminds(true, ruleID: "domain")
        #expect(await center.prompts == 1)
        #expect(renewals.reminds("domain"))
        try await apply(renewals, Self.ledger())
        #expect(await center.days == ["penny.renewal.domain": Self.day("2027-01-29")])
        #expect(
            await center.texts == [
                RenewalText.Notification(
                    title: "A yearly schedule renews in 3 days", body: "Open Penny to see which one.")
            ])

        let again = RenewalReminders(defaults: defaults, center: center)
        await again.ownerChanged(Self.owner)
        #expect(again.reminds("domain"), "kept on the device for the account")
    }

    @Test("whenShowNameAndAmountIsOn_RenewalReminders_ShouldNameTheScheduleAndItsAmount")
    func details() async throws {
        let center = FakeRenewalCenter(permission: .allowed)
        let renewals = RenewalReminders(defaults: nil, center: center)
        await renewals.ownerChanged(Self.owner)
        await renewals.setReminds(true, ruleID: "domain")
        renewals.setShowsDetails(true, ruleID: "domain")
        try await apply(renewals, Self.ledger(next: "2026-11-14"))
        #expect(await center.prompts == 0, "already allowed")
        #expect(
            await center.texts == [
                RenewalText.Notification(title: "Domain name renews in 3 days", body: "$24.00 on Sat, Nov 14.")
            ])
    }

    @Test("whenIOSSaysNo_RenewalReminders_ShouldStayOffAndSayWhy")
    func denied() async throws {
        let center = FakeRenewalCenter(permission: .notDetermined, answer: false)
        let renewals = RenewalReminders(defaults: nil, center: center)
        await renewals.ownerChanged(Self.owner)
        await renewals.setReminds(true, ruleID: "domain")
        #expect(!renewals.reminds("domain"))
        #expect(renewals.permissionDenied)
        try await apply(renewals, Self.ledger())
        #expect(await center.pending.isEmpty)
    }

    @Test("whenNotificationsAreTurnedOffInSettingsLater_RenewalReminders_ShouldScheduleNothingAndSayWhy")
    func revoked() async throws {
        let center = FakeRenewalCenter(permission: .allowed)
        let renewals = RenewalReminders(defaults: nil, center: center)
        await renewals.ownerChanged(Self.owner)
        await renewals.setReminds(true, ruleID: "domain")
        await center.revoke()
        try await apply(renewals, Self.ledger())
        #expect(await center.pending.isEmpty)
        #expect(renewals.permissionDenied)
        #expect(renewals.reminds("domain"), "the switch is kept for when notifications come back")
    }

    @Test("whenTheScheduleIsPausedEditedOrRemoved_RenewalReminders_ShouldFollow")
    func follows() async throws {
        let center = FakeRenewalCenter(permission: .allowed)
        let renewals = RenewalReminders(defaults: nil, center: center)
        await renewals.ownerChanged(Self.owner)
        await renewals.setReminds(true, ruleID: "domain")
        try await apply(renewals, Self.ledger())
        #expect(await center.days["penny.renewal.domain"] == Self.day("2027-01-29"))

        try await apply(renewals, Self.ledger(next: "2027-03-10"))
        #expect(await center.days["penny.renewal.domain"] == Self.day("2027-03-07"), "an edit moves it")

        try await apply(renewals, Self.ledger(next: "2027-03-10", active: false))
        #expect(await center.pending.isEmpty, "pausing cancels it")

        try await apply(renewals, Self.ledger(next: "2027-03-10"))
        #expect(await center.pending.count == 1, "resuming brings it back")

        try await apply(renewals, Self.ledger(next: "2027-03-10", frequency: .monthly))
        #expect(await center.pending.isEmpty, "only yearly schedules remind")

        try await apply(renewals, Ledger(currency: .usd))
        #expect(await center.pending.isEmpty, "removing cancels it")
        #expect(!renewals.reminds("domain"), "and forgets its switch")
    }

    @Test("whenTheAccountSignsOutOrChanges_RenewalReminders_ShouldRemoveTheWaitingOnes")
    func signOut() async throws {
        let center = FakeRenewalCenter(permission: .allowed)
        let defaults = try Self.defaults()
        let renewals = RenewalReminders(defaults: defaults, center: center)
        await renewals.ownerChanged(Self.owner)
        await renewals.setReminds(true, ruleID: "domain")
        try await apply(renewals, Self.ledger())
        #expect(await center.pending.count == 1)

        await renewals.ownerChanged(.unknown)
        #expect(await center.pending.count == 1, "restoring keeps them")
        await renewals.ownerChanged(.account("owner-b"))
        #expect(await center.pending.isEmpty)
        #expect(!renewals.reminds("domain"), "another account's switches")
        try await apply(renewals, Self.ledger())
        #expect(await center.pending.isEmpty)

        await renewals.ownerChanged(.nobody)
        #expect(!renewals.offersReminders)
        await renewals.ownerChanged(Self.owner)
        #expect(renewals.reminds("domain"))
    }

    @Test("whenThereIsNoCenter_RenewalReminders_ShouldOfferNothing")
    func preview() async throws {
        let renewals = RenewalReminders(defaults: nil, center: nil)
        await renewals.ownerChanged(Self.owner)
        #expect(!renewals.offersReminders)
        await renewals.setReminds(true, ruleID: "domain")
        #expect(!renewals.reminds("domain"))
    }

    @Test("whenARowRenewsSoon_ScheduleText_ShouldSayRenewsAndTheDay")
    func rowText() {
        let soon = Self.ledger(next: "2026-11-12").recurring[0]
        #expect(ScheduleText.timing(soon, today: Self.day("2026-11-09")).hasPrefix("Yearly · renews "))
        #expect(ScheduleText.timing(soon, today: Self.day("2026-11-01")).hasPrefix("Yearly · next "))
        #expect(RenewalText.renewsIn(3) == "Renews in 3 days")
        #expect(RenewalText.renewsIn(1) == "Renews tomorrow")
        #expect(RenewalText.renewsIn(0) == "Renews today")
        #expect(RenewalText.footer(onPad: false).hasPrefix("This iPhone reminds you 3 days before, at 9 AM."))
        #expect(RenewalText.footer(onPad: true).hasPrefix("This iPad reminds you"))
    }
}
