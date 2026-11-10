import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Recurrence")
struct RecurrenceTests {
    static func frequency(_ text: String) throws -> RecurrenceFrequency {
        try #require(RecurrenceFrequency(rawValue: text))
    }

    @Test("whenGoldenNextCase_Next_ShouldMatchRecurrenceFixture")
    func goldenNext() throws {
        let fixture = try Fixtures.decode(RecurrenceFixture.self, from: "recurrence.json")
        let parity = try Fixtures.decode(ParityFixture.self, from: "parity-cases.json")
        let cases =
            fixture.next.map { ($0.date, $0.frequency, $0.anchorDay, $0.next) }
            + parity.dates.map { ($0.date, $0.frequency, $0.anchorDay, $0.next) }
        #expect(cases.count >= 10)
        for (date, frequency, anchorDay, next) in cases {
            let actual = Recurrence.next(
                after: try ContractLedger.date(date), frequency: try Self.frequency(frequency), anchorDay: anchorDay)
            #expect(actual.description == next, "\(date) \(frequency) anchor \(anchorDay)")
        }
    }

    @Test("whenGoldenSequence_Next_ShouldKeepTheAnchorEveryStep")
    func goldenSequences() throws {
        let fixture = try Fixtures.decode(RecurrenceFixture.self, from: "recurrence.json")
        for sequence in fixture.sequences {
            var date = try ContractLedger.date(sequence.start)
            var dates = [date.description]
            while dates.count < sequence.dates.count {
                date = Recurrence.next(
                    after: date, frequency: try Self.frequency(sequence.frequency), anchorDay: sequence.anchorDay)
                dates.append(date.description)
            }
            #expect(dates == sequence.dates, "\(sequence.start) \(sequence.frequency)")
        }
    }

    @Test("whenAnchoredOnTheLastDays_Monthly_ShouldClampToShortMonthsAndReturn")
    func shortMonthsAndLeapYears() {
        func dates(_ start: String, _ anchor: Int, _ frequency: RecurrenceFrequency, _ count: Int) -> [String] {
            var date = CalendarDate.day(start)
            return (0..<count).map { _ in
                defer { date = Recurrence.next(after: date, frequency: frequency, anchorDay: anchor) }
                return date.description
            }
        }
        #expect(dates("2024-01-30", 30, .monthly, 4) == ["2024-01-30", "2024-02-29", "2024-03-30", "2024-04-30"])
        #expect(dates("2023-12-31", 31, .monthly, 3) == ["2023-12-31", "2024-01-31", "2024-02-29"])
        // Yearly on Feb 29 lands on Feb 28 in common years and returns in the next leap year.
        #expect(
            dates("2024-02-29", 29, .yearly, 5) == [
                "2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29",
            ])
        // 2100 is not a leap year (divisible by 100, not 400); 2000 is.
        #expect(dates("2096-02-29", 29, .yearly, 5).last == "2100-02-28")
        #expect(dates("1999-02-28", 29, .yearly, 2).last == "2000-02-29")
        // Weekly crosses month, year and DST boundaries by exactly seven calendar days.
        #expect(dates("2026-12-29", 1, .weekly, 2).last == "2027-01-05")
        #expect(dates("2026-03-05", 5, .weekly, 2).last == "2026-03-12")
    }

    @Test("whenEveryDayOfAFourHundredYearCycle_CalendarDate_ShouldRoundTripTheEpochDay")
    func calendarArithmetic() {
        var date = CalendarDate.day("2000-01-01")
        var count = 0
        var broken: [String] = []
        while date <= .day("2100-12-31") {
            let next = date.adding(days: 1)
            if next.days(since: date) != 1 || next <= date || CalendarDate(next.description) != next {
                broken.append(date.description)
            }
            date = next
            count += 1
        }
        #expect(broken.isEmpty)
        // 101 years, 25 leap years (2000 is one, 2100 is not).
        #expect(count == 101 * 365 + 25)
    }

    @Test(
        "whenTextIsNotAStrictLedgerDate_LedgerDate_ShouldBeNil",
        arguments: [
            "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "1999-12-31", "2101-01-01", "2026-1-01",
            "2026/01/01", " 2026-01-01", "２０２６-01-01", "2026-01-01T00:00",
        ])
    func invalidDates(text: String) {
        #expect(CalendarDate.ledgerDate(text) == nil)
    }

    @Test("whenDatesAreDue_Materialize_ShouldCatchUpOnceAndAdvancePastToday")
    func materializeCatchUp() throws {
        let rule = Sample.rule("gym", start: "2026-01-31", next: "2026-01-31", anchorDay: 31)
        let ledger = Sample.ledger(recurring: [rule])
        let result = Recurrence.materialize(ledger, today: .day("2026-04-15"))
        #expect(result.transactions.map(\.id) == ["gym:2026-01-31", "gym:2026-02-28", "gym:2026-03-31"])
        #expect(result.transactions.allSatisfy { $0.recurringId == "gym" && $0.share == 4000 && $0.tripId == nil })
        #expect(result.recurring[0].nextDate == .day("2026-04-30"))
        #expect(result.recurring[0].anchorDay == 31)
        // Idempotent: a second run on the same or an earlier day changes nothing.
        #expect(Recurrence.materialize(result, today: .day("2026-04-15")) == result)
        #expect(Recurrence.materialize(result, today: .day("2026-04-01")) == result)
        // The input is a value and stays unchanged.
        #expect(ledger.transactions.isEmpty)
    }

    @Test("whenOccurrenceWasDeletedOrEdited_Materialize_ShouldNeverRecordItAgain")
    func noDuplicateMaterialization() {
        let rule = Sample.rule("rent", start: "2026-01-01", next: "2026-02-01")
        // January was recorded, then its date and amount were edited: the id keeps the rule date.
        let edited = Sample.entry("rent:2026-01-01", "2026-01-03", share: 9999, recurringId: "rent")
        // A merged ledger from another device may hold an occurrence the rule has not passed yet.
        let fromOtherDevice = Recurrence.occurrence(of: rule, on: .day("2026-02-01"))
        let ledger = Sample.ledger(transactions: [edited, fromOtherDevice], recurring: [rule])
        let result = Recurrence.materialize(ledger, today: .day("2026-03-01"))
        #expect(result.transactions.map(\.id) == ["rent:2026-01-01", "rent:2026-02-01", "rent:2026-03-01"])
        #expect(result.transactions[0].share == 9999)
        // Deleting a recorded occurrence: the rule is already past it.
        var deleted = result
        deleted.transactions.removeAll { $0.id == "rent:2026-02-01" }
        #expect(Recurrence.materialize(deleted, today: .day("2026-03-01")) == deleted)
    }

    @Test("whenRuleIsPaused_Materialize_ShouldLeaveItUntouched")
    func pausedRule() {
        let ledger = Sample.ledger(recurring: [Sample.rule("mag", start: "2026-01-15", active: false)])
        #expect(Recurrence.materialize(ledger, today: .day("2026-12-31")) == ledger)
    }

    @Test("whenBrowsingAMonth_Previews_ShouldListUnrecordedOccurrencesWithoutChangingTheLedger")
    func previews() {
        let weekly = Sample.rule("w", start: "2026-10-01", next: "2026-10-22", frequency: .weekly, share: 100)
        let monthly = Sample.rule("m", start: "2026-09-30", next: "2026-10-31", anchorDay: 31)
        let recorded = Recurrence.occurrence(of: weekly, on: .day("2026-10-29"))
        let ledger = Sample.ledger(
            transactions: [recorded],
            recurring: [weekly, monthly, Sample.rule("off", start: "2026-10-01", active: false)])
        let november = Recurrence.previews(ledger, from: .day("2026-11-01"), through: .day("2026-11-30"))
        #expect(november.map(\.id) == ["w:2026-11-05", "w:2026-11-12", "w:2026-11-19", "w:2026-11-26", "m:2026-11-30"])
        let october = Recurrence.previews(ledger, from: .day("2026-10-01"), through: .day("2026-10-31"))
        #expect(october.map(\.id) == ["w:2026-10-22", "m:2026-10-31"])
        #expect(ledger.recurring[0].nextDate == .day("2026-10-22"))
    }

    @Test("whenInstantIsNearMidnight_CalendarDate_ShouldUseTheCalendarsTimeZoneAndGregorianDay")
    func todayFromInstant() throws {
        // 2026-03-01T04:30:00Z is still Feb 28 in Toronto (UTC-5) and already Mar 1 in Tokyo.
        let instant = Date(timeIntervalSince1970: 1_772_339_400)
        var toronto = Calendar(identifier: .gregorian)
        toronto.timeZone = try #require(TimeZone(identifier: "America/Toronto"))
        var tokyo = Calendar(identifier: .japanese)
        tokyo.timeZone = try #require(TimeZone(identifier: "Asia/Tokyo"))
        #expect(CalendarDate(instant, in: toronto) == .day("2026-02-28"))
        #expect(CalendarDate(instant, in: tokyo) == .day("2026-03-01"))
    }

    /// Known limitation kept from legacy (docs/ios-ledger-domain.md): materializing in 2100 can
    /// move `nextDate` past the ledger range. There is no legacy error path there, so the rule
    /// advances and `Ledger.violations` names it, so a client can still refuse to acknowledge it.
    @Test("whenMaterializingInLate2100_Materialize_ShouldAdvancePastTheRangeAndViolationsNameIt")
    func materializePastLedgerRange() {
        let ledger = Sample.ledger(recurring: [Sample.rule("gym", start: "2100-11-30", next: "2100-12-30")])
        let next = Recurrence.materialize(ledger, today: .day("2100-12-31"))
        #expect(next.transactions.map(\.id) == ["gym:2100-12-30"])
        #expect(next.recurring[0].nextDate == .day("2101-01-30"))
        #expect(next.violations == [.dateOutOfRange("gym")])
    }
}
