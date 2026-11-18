import Foundation
import PennyDomain
import Testing
import WidgetKit

@testable import PennyWidgetUI

@Suite("Widgets: Month at a glance and Lock Screen")
struct WidgetLockScreenTests {
    static func snapshot(
        month: String = "2026-11", income: Int64 = 320_000, spent: Int64 = 148_335, invested: Int64 = 60_000,
        left: Int64 = 111_665
    ) -> WidgetSnapshot {
        WidgetSnapshot(
            month: month, currency: "CAD", generatedAt: Date(timeIntervalSince1970: 1_794_000_000), income: income,
            spent: spent, invested: invested, leftToSpend: left, projectedRemaining: left, recentExpenses: [],
            waitingToSync: false)
    }

    static let locale = Locale(identifier: "en_CA")

    @Test("whenIncomeWasRecorded_WidgetLeftShare_ShouldBeTheShareOfIncomeLeft")
    func share() throws {
        // The design sample: $1,116.65 of $3,200.00 is 34.9 %, shown as 35 %.
        let share = try #require(WidgetLeftShare(Self.snapshot()))
        #expect(abs(share.fraction - 111_665.0 / 320_000.0) < 0.000_1)
        #expect(share.percent == 35)
    }

    @Test("whenOverspentOrWithoutIncome_WidgetLeftShare_ShouldStayInRangeOrBeAbsent")
    func shareEdges() throws {
        let over = try #require(
            WidgetLeftShare(Self.snapshot(income: 10_000, spent: 25_000, invested: 0, left: -15_000)))
        #expect(over.fraction == 0)
        #expect(over.percent == 0)
        #expect(WidgetLeftShare(Self.snapshot(income: 0, spent: 4200, invested: 0, left: -4200)) == nil)
        #expect(WidgetLeftShare(Self.snapshot(income: 0, spent: 0, invested: 0, left: 0)) == nil)
    }

    @Test("whenShowingLeftToSpend_LockText_ShouldDropTheCentsAndKeepTheSign")
    func whole() {
        #expect(LockText.whole(Self.snapshot(), locale: Self.locale) == "$1,116")
        #expect(LockText.whole(Self.snapshot(left: -4250), locale: Self.locale) == "\u{2212}$42")
        #expect(LockText.whole(Self.snapshot(left: 0), locale: Self.locale) == "$0")
    }

    @Test("whenReadByVoiceOver_LockText_ShouldSpeakEveryStateWithoutSymbols")
    func spoken() {
        let snapshot = Self.snapshot()
        #expect(LockText.spoken(.signedOut, locale: Self.locale) == "Sign in to Penny")
        #expect(LockText.spoken(.openApp, locale: Self.locale) == "Open Penny to update")
        #expect(
            LockText.spoken(.ready(snapshot, .current), locale: Self.locale)
                == "Left to spend in November, $1,116.65")
        #expect(
            LockText.spokenShare(.ready(snapshot, .current), locale: Self.locale)
                == "35 percent of income left to spend in November")
        #expect(
            LockText.spokenShare(
                .ready(Self.snapshot(income: 0, spent: 0, invested: 0, left: 0), .pastMonth),
                locale: Self.locale)
                == "No income recorded in November. Open Penny to update")
        #expect(LockText.spokenShare(.signedOut, locale: Self.locale) == "Sign in to Penny")
    }

    #if os(iOS)
        @Test("whenListingFamilies_BalanceWidget_ShouldAddMediumAndLockScreenAndKeepRecentSmall")
        func families() {
            #expect(
                PennyWidgetStyle.balanceFamilies == [
                    .systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular,
                ])
            #expect(PennyWidgetStyle.recentFamilies == [.systemSmall])
        }
    #endif
}
