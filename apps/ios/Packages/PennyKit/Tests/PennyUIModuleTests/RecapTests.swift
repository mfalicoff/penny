import Foundation
import PennyData
import PennyDesign
import PennyDomain
import Testing

@testable import PennyUI

/// A notification center that records what the monthly recap asks of it.
actor FakeRecapCenter: RecapNotificationCenter {
    var current: PushPermission
    /// What the system prompt answers.
    let answer: Bool
    private(set) var prompts = 0
    private(set) var pending: [String: (reminder: RecapReminder, body: String)] = [:]
    /// Someone else's notification, which the recap must never remove.
    let other = "household-expense"

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

    func schedule(_ reminder: RecapReminder, body: String) async throws {
        pending[reminder.identifier] = (reminder, body)
    }

    func removePending(_ identifiers: [String]) async {
        #expect(!identifiers.contains(other), "only recap notifications are removed")
        for id in identifiers { pending[id] = nil }
    }

    func revoke() { current = .denied }

    var bodies: [String] { pending.values.sorted { $0.reminder.day < $1.reminder.day }.map(\.body) }
    var days: [CalendarDate] { pending.values.map(\.reminder.day).sorted() }
}

@Suite("Monthly recap in the app")
@MainActor
struct RecapTests {
    /// 2026-11-01 at `hour`:`minute` in Toronto.
    static func instant(day: Int = 1, hour: Int, minute: Int = 0) throws -> (Date, Calendar) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Toronto"))
        let date = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)))
        return (date, calendar)
    }

    static func defaults() throws -> UserDefaults {
        let name = "penny.tests.recap.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    // MARK: Banner

    private func report(_ entries: [(String, String)]) -> LedgerReport {
        LedgerReport(
            ledger: Ledger(
                transactions: entries.map {
                    LedgerEntry(
                        id: $0.0, title: $0.0, kind: .expense, total: 1_000, share: 1_000, categoryId: "food",
                        date: CalendarDate($0.1) ?? .earliest)
                }))
    }

    @Test("whenInTheFirstWeekWithAnOctoberEntry_RecapBanner_ShouldOfferOctoberUntilDismissed")
    func banner() throws {
        let defaults = try Self.defaults()
        let recap = MonthlyRecap(defaults: defaults, center: nil)
        let report = report([("coffee", "2026-10-12")])
        let october = try #require(MonthKey("2026-10"))
        #expect(recap.bannerMonth(today: try #require(CalendarDate("2026-11-01")), report: report) == october)
        #expect(recap.bannerMonth(today: try #require(CalendarDate("2026-11-07")), report: report) == october)
        #expect(recap.bannerMonth(today: try #require(CalendarDate("2026-11-08")), report: report) == nil)
        recap.dismiss(october)
        #expect(recap.bannerMonth(today: try #require(CalendarDate("2026-11-02")), report: report) == nil)
        // Kept on the device: a new model reads the dismissal back.
        let again = MonthlyRecap(defaults: defaults, center: nil)
        #expect(again.isDismissed(october))
        #expect(!again.isDismissed(try #require(MonthKey("2026-09"))))
    }

    @Test("whenLastMonthHasNoRecordedEntry_RecapBanner_ShouldNotShow")
    func emptyBanner() throws {
        let recap = MonthlyRecap(defaults: nil, center: nil)
        let report = report([("coffee", "2026-09-12")])
        #expect(recap.bannerMonth(today: try #require(CalendarDate("2026-11-03")), report: report) == nil)
    }

    @Test("whenInsightsShowsAMonth_RecapButton_ShouldOpenItOnceItIsOver")
    func recapButtonMonth() throws {
        let today = try #require(CalendarDate("2026-11-20"))
        let november = MonthKey(today)
        let september = try #require(MonthKey("2026-09"))
        #expect(InsightsView.recapMonth(shown: november, today: today) == november.shifted(by: -1))
        #expect(InsightsView.recapMonth(shown: september, today: today) == september)
        let months = RecapView.months(today: today, including: try #require(MonthKey("2024-01")))
        #expect(months.first == november.shifted(by: -1), "the recap offers past months only, newest first")
        #expect(months.count == 13)
    }

    // MARK: Notification

    @Test("whenTurnedOn_RecapNotification_ShouldAskOnceAndScheduleTheNextFirstsAt9")
    func turnOn() async throws {
        let center = FakeRecapCenter(permission: .notDetermined)
        let defaults = try Self.defaults()
        let recap = MonthlyRecap(defaults: defaults, center: center)
        #expect(!recap.notifies, "off by default")
        #expect(await center.prompts == 0, "nothing is asked before the switch is turned on")
        let (now, calendar) = try Self.instant(day: 3, hour: 10)
        await recap.setNotifies(true, now: now, calendar: calendar)
        #expect(recap.notifies)
        #expect(await center.prompts == 1)
        let days = await center.days
        #expect(days.count == MonthlyRecap.scheduledCount)
        #expect(days.first == CalendarDate("2026-12-01"))
        #expect(days.allSatisfy { $0.day == 1 })
        let bodies = await center.bodies
        #expect(bodies.first == "Your November recap is ready.")
        #expect(bodies.dropFirst().first == "Your December recap is ready.")
        // No amounts and no names: the body is the month alone.
        #expect(bodies.allSatisfy { !$0.contains("$") })
        #expect(MonthlyRecap(defaults: defaults, center: center).notifies, "kept on the device")
    }

    @Test("whenItIsTheFirstBefore9_RecapNotification_ShouldStillDeliverToday")
    func beforeNine() async throws {
        let center = FakeRecapCenter(permission: .allowed)
        let recap = MonthlyRecap(defaults: nil, center: center)
        let (early, calendar) = try Self.instant(day: 1, hour: 8, minute: 59)
        await recap.setNotifies(true, now: early, calendar: calendar)
        #expect(await center.days.first == CalendarDate("2026-11-01"))
        #expect(await center.bodies.first == "Your October recap is ready.")
        #expect(await center.prompts == 0, "already allowed: no prompt")
        let (late, _) = try Self.instant(day: 1, hour: 9)
        await recap.reschedule(now: late, calendar: calendar)
        #expect(await center.days.first == CalendarDate("2026-12-01"), "today's 9:00 has passed")
        #expect(await center.days.count == MonthlyRecap.scheduledCount, "replaced, not added")
    }

    @Test("whenPermissionIsDenied_RecapNotification_ShouldStayOffAndSayWhy")
    func denied() async throws {
        let center = FakeRecapCenter(permission: .notDetermined, answer: false)
        let recap = MonthlyRecap(defaults: nil, center: center)
        let (now, calendar) = try Self.instant(hour: 12)
        await recap.setNotifies(true, now: now, calendar: calendar)
        #expect(!recap.notifies)
        #expect(recap.permissionDenied)
        #expect(await center.days.isEmpty)
        // Asked again later, iOS answers at once: still no prompt shown twice by Penny.
        await recap.setNotifies(true, now: now, calendar: calendar)
        #expect(await center.prompts == 1)
        #expect(!recap.notifies)
    }

    @Test("whenTurnedOffOrRevoked_RecapNotification_ShouldRemoveOnlyItsOwnPendingNotifications")
    func turnOff() async throws {
        let center = FakeRecapCenter(permission: .allowed)
        let recap = MonthlyRecap(defaults: nil, center: center)
        let (now, calendar) = try Self.instant(hour: 12)
        await recap.setNotifies(true, now: now, calendar: calendar)
        await recap.setNotifies(false, now: now, calendar: calendar)
        #expect(!recap.notifies)
        #expect(await center.days.isEmpty)
        // Turned off for Penny in iOS Settings while on: the next activation turns the switch off.
        await recap.setNotifies(true, now: now, calendar: calendar)
        await center.revoke()
        await recap.reschedule(now: now, calendar: calendar)
        #expect(!recap.notifies)
        #expect(recap.permissionDenied)
        #expect(await center.days.isEmpty)
    }

    @Test("whenNoCenter_RecapNotification_ShouldNotBeOffered")
    func previews() async throws {
        let recap = MonthlyRecap(defaults: nil, center: nil)
        #expect(!recap.offersNotification)
        await recap.setNotifies(true, now: Date(), calendar: .current)
        #expect(!recap.notifies)
    }

    @Test("whenARecapNotificationIsOpened_PushNotifications_ShouldOpenTheRecapForTheSignedInAccount")
    func opening() throws {
        let target = try #require(NotificationTarget(userInfo: ["recapMonth": "2026-10"]))
        #expect(target.deepLink == .recap(month: try #require(MonthKey("2026-10"))))
        #expect(NotificationTarget(userInfo: ["recapMonth": "2026-13"]) == nil, "not a month")
        #expect(NotificationTarget(userInfo: ["recapMonth": "2026-10", "householdId": "h1"]) == nil)
        var route = ShellRoute(tab: .trips)
        route.open(target.deepLink)
        #expect(route.tab == .home)
        #expect(route.path(for: .home) == [.recap(month: try #require(MonthKey("2026-10")))])
    }

    // MARK: Text

    @Test("whenComparingMonths_RecapText_ShouldReadAsTheCard")
    func text() throws {
        let fixture = LedgerReport(
            ledger: Ledger(
                categories: Ledger.defaultCategories,
                transactions: [
                    LedgerEntry(
                        id: "sep", title: "s", kind: .expense, total: 221_000, share: 221_000, categoryId: "food",
                        date: try #require(CalendarDate("2026-09-10"))),
                    LedgerEntry(
                        id: "oct-2025", title: "o", kind: .expense, total: 214_000, share: 214_000,
                        categoryId: "food", date: try #require(CalendarDate("2025-10-10"))),
                    LedgerEntry(
                        id: "oct", title: "n", kind: .expense, total: 229_500, share: 229_500, categoryId: "food",
                        date: try #require(CalendarDate("2026-10-10"))),
                    LedgerEntry(
                        id: "fun", title: "f", kind: .expense, total: 5_350, share: 5_350, categoryId: "fun",
                        date: try #require(CalendarDate("2026-10-18"))),
                ]))
        let october = try #require(MonthKey("2026-10"))
        let review = fixture.review(october, today: try #require(CalendarDate("2026-11-03")))
        let sentence = try #require(RecapText.comparison(review))
        #expect(sentence.lead == "6% more than September")
        #expect(sentence.rest == ", and 10% more than October last year.")
        #expect(RecapText.title(october) == "October recap")
        #expect(RecapText.barTitle(review.lastYear.month, lastYear: true) == "Oct 2025")
        let new = try #require(review.biggestChanges.first { $0.percent == nil })
        #expect(RecapText.chip(new) == "New")
        #expect(
            RecapText.previously(new, month: review.previous.month, currency: "CAD").hasPrefix("Nothing in September"))
        #expect(RecapText.noComparison(review.previous.month, lastYear: false) == "No September to compare with")
        #expect(RecapText.bannerTitle(october) == "Your October recap is ready")
        #expect(RecapText.notificationBody(october) == "Your October recap is ready.")
        // A first month: only last year compared, or nothing at all.
        let first = LedgerReport(ledger: Ledger(transactions: [fixture.ledger.transactions[2]]))
            .review(october, today: try #require(CalendarDate("2026-11-03")))
        #expect(RecapText.comparison(first) == nil)
    }

    @Test("whenPaidAndSplit_RecapText_ShouldNameThePayerAndWhatOthersPaid")
    func sharedText() throws {
        let top = TopShared(
            id: "household:h:e", title: "Costco run", categoryId: "groceries",
            date: try #require(CalendarDate("2026-10-14")), share: 6_140, total: 18_420,
            payer: .member(name: "Former member"))
        #expect(RecapText.topShared(top) == "Your top shared expense · Former member paid")
        let split = RecapText.split(MonthReview.Split(count: 3, total: 102_460, share: 41_180), currency: "CAD")
        #expect(split.title.hasPrefix("Others paid"))
        #expect(split.title.contains("612.80"))
        #expect(split.detail.contains("1,024.60"))
        #expect(split.detail.hasSuffix("in split expenses"))
        #expect(RecapSettingText.footer(device: "iPhone").contains("It never shows amounts or entry names."))
        #expect(RecapSettingText.detail == "On the 1st, at 9 AM")
    }
}
