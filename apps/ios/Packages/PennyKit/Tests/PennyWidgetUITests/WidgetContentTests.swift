import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyWidgetUI

@Suite("Widgets: states, links and labels")
struct WidgetContentTests {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto") ?? .gmt
        return calendar
    }

    static func date(_ text: String) throws -> Date {
        try #require(ISO8601DateFormatter().date(from: text))
    }

    static func snapshot(
        month: String = "2026-11", generatedAt: Date, left: Int64 = 111_665, projected: Int64 = 96_665,
        waiting: Bool = false, income: Int64 = 320_000, spent: Int64 = 148_335, invested: Int64 = 60_000
    ) -> WidgetSnapshot {
        WidgetSnapshot(
            month: month, currency: "CAD", generatedAt: generatedAt, income: income, spent: spent, invested: invested,
            leftToSpend: left, projectedRemaining: projected, recentExpenses: [], waitingToSync: waiting)
    }

    @Test("whenSignedOutOrUnreadable_WidgetContent_ShouldNeverHoldMoney")
    func messages() throws {
        let now = try Self.date("2026-11-12T15:00:00Z")
        #expect(WidgetContent(.signedOut, now: now, calendar: Self.calendar) == .signedOut)
        #expect(WidgetContent(.unreadable, now: now, calendar: Self.calendar) == .openApp)
    }

    @Test("whenSnapshotIsThisMonthAndRecent_WidgetContent_ShouldBeCurrent")
    func current() throws {
        let now = try Self.date("2026-11-12T15:00:00Z")
        let snapshot = Self.snapshot(generatedAt: now.addingTimeInterval(-60))
        #expect(WidgetContent(.snapshot(snapshot), now: now, calendar: Self.calendar) == .ready(snapshot, .current))
    }

    @Test("whenSnapshotIsOlderThanTwelveHours_WidgetContent_ShouldSayWhenItWasUpdated")
    func old() throws {
        let now = try Self.date("2026-11-12T15:00:00Z")
        let built = now.addingTimeInterval(-WidgetContent.oldAfter - 1)
        let snapshot = Self.snapshot(generatedAt: built)
        #expect(
            WidgetContent(.snapshot(snapshot), now: now, calendar: Self.calendar)
                == .ready(snapshot, .old(since: built)))
    }

    @Test("whenTheMonthHasEnded_WidgetContent_ShouldBePastMonth")
    func pastMonth() throws {
        // 00:30 on December 1 in Toronto, 05:30 UTC: the device's month is December.
        let now = try Self.date("2026-12-01T05:30:00Z")
        let snapshot = Self.snapshot(generatedAt: now.addingTimeInterval(-3600))
        #expect(WidgetContent(.snapshot(snapshot), now: now, calendar: Self.calendar) == .ready(snapshot, .pastMonth))
        // 23:30 on November 30 in Toronto is still November, although it is December in UTC.
        let evening = try Self.date("2026-12-01T04:30:00Z")
        #expect(
            WidgetContent(.snapshot(snapshot), now: evening, calendar: Self.calendar) == .ready(snapshot, .current))
    }

    @Test("whenWidgetIsTapped_WidgetLink_ShouldOpenHomeAndTheAddEntrySheet")
    func links() {
        #expect(DeepLink(url: WidgetLink.balance) == .home)
        #expect(DeepLink(url: WidgetLink.addEntry) == .addEntry)
    }

    @Test("whenSampleIsShown_WidgetContent_ShouldBeConsistentFixtureData")
    func sample() throws {
        guard case .ready(let snapshot, .current) = WidgetContent.sample else {
            Issue.record("The sample is a current snapshot")
            return
        }
        #expect(snapshot.leftToSpend == snapshot.income - snapshot.spent - snapshot.invested)
        #expect(snapshot.recentExpenses.count == WidgetSnapshot.maxRecentExpenses)
    }

    @Test("whenMoneyWasRecorded_WidgetFlowBar_ShouldSplitTheLargerOfIncomeAndOutflow")
    func flowBar() {
        let now = Date(timeIntervalSince1970: 0)
        let bar = WidgetFlowBar(Self.snapshot(generatedAt: now, left: 111_665))
        #expect(abs(bar.spent + bar.invested + bar.left - 1) < 0.000_1)

        // More went out than came in: the bar is the outflow, nothing is left.
        let over = WidgetFlowBar(
            Self.snapshot(generatedAt: now, left: -20_000, income: 10_000, spent: 25_000, invested: 5000))
        #expect(over.left == 0)
        #expect(abs(over.spent - 25_000.0 / 30_000.0) < 0.000_1)
        #expect(abs(over.invested - 5000.0 / 30_000.0) < 0.000_1)

        let empty = WidgetFlowBar(Self.snapshot(generatedAt: now, left: 0, income: 0, spent: 0, invested: 0))
        #expect(empty.isEmpty)
    }

    @Test("whenProjectedDiffers_BalanceText_ShouldShowBothAndSpeakThem")
    func balanceText() {
        let locale = Locale(identifier: "en_CA")
        let snapshot = Self.snapshot(generatedAt: .now)
        #expect(BalanceText.monthName("2026-11", locale: locale) == "November")
        #expect(BalanceText.projected(snapshot, locale: locale) == "$966.65 projected")
        let spoken = BalanceText.spoken(snapshot, freshness: .current, locale: locale)
        #expect(spoken == "Left to spend in November, $1,116.65. Projected, $966.65")

        let same = Self.snapshot(generatedAt: .now, left: 500, projected: 500)
        #expect(BalanceText.projected(same, locale: locale) == nil)
        let belowZero = Self.snapshot(generatedAt: .now, left: 100, projected: -4200)
        #expect(BalanceText.projected(belowZero, locale: locale) == "\u{2212}$42.00 projected")

        let negative = Self.snapshot(generatedAt: .now, left: -4200, projected: -4200, waiting: true)
        #expect(
            BalanceText.spoken(negative, freshness: .current, locale: locale)
                == "Left to spend in November, minus $42.00. As of last sync")
        #expect(
            BalanceText.spoken(same, freshness: .pastMonth, locale: locale)
                == "Left to spend in November, $5.00. Open Penny to update")
    }

    @Test("whenProviderReads_PennyTimelineProvider_ShouldReloadAfterMidnightAndMapMissingGroup")
    func provider() throws {
        let now = try Self.date("2026-11-12T15:00:00Z")
        let snapshot = Self.snapshot(generatedAt: now)
        let provider = PennyTimelineProvider(calendar: Self.calendar) { .snapshot(snapshot) }
        #expect(provider.entry(at: now).content == .ready(snapshot, .current))
        // Midnight in Toronto is 05:00 UTC; the reload is a minute after it.
        #expect(provider.nextReload(after: now) == (try Self.date("2026-11-13T05:01:00Z")))

        let missing = PennyTimelineProvider(calendar: Self.calendar) { nil }
        #expect(missing.entry(at: now).content == .openApp)
    }
}
