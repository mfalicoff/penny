import PennyDomain
import Testing

@testable import PennyUI

@Suite("Entry detail split (MAZ-246)")
struct EntryDetailTextTests {
    @Test("whenTheShareIsAnEqualPart_EntryDetailText_ShouldReadEquallyWithTheHeadCount")
    func equal() {
        let split = EntryDetailText.split(kind: .expense, total: 1280, share: 640)
        #expect(split == EntryDetailText.Split(method: "Equally · 2 people", people: 2))
        #expect(split.map(EntryDetailText.others) == "1 other person")
    }

    @Test("whenAnEqualShareWasRoundedUp_EntryDetailText_ShouldStillReadEqually")
    func roundedEqual() throws {
        // $10.01 three ways is $3.34 for you (Money.personalShare rounds half up).
        let share = try Money.personalShare(total: 1001, mode: .equal, input: "3")
        let split = EntryDetailText.split(kind: .expense, total: 1001, share: share)
        #expect(split?.method == "Equally · 3 people")
        #expect(split.map(EntryDetailText.others) == "2 other people")
    }

    @Test("whenTheShareIsNoEqualPart_EntryDetailText_ShouldReadCustomShare")
    func custom() {
        let split = EntryDetailText.split(kind: .expense, total: 1000, share: 300)
        #expect(split == EntryDetailText.Split(method: "Custom share", people: nil))
        #expect(split.map(EntryDetailText.others) == "Other people")
    }

    @Test(
        "whenTheEntryIsNotASplitExpense_EntryDetailText_ShouldHaveNoSplit",
        arguments: [
            (EntryKind.expense, Int64(1280), Int64(1280)),
            (EntryKind.expense, Int64(1280), Int64(0)),
            (EntryKind.income, Int64(1280), Int64(640)),
            (EntryKind.investment, Int64(1280), Int64(640)),
        ])
    func notSplit(kind: EntryKind, total: Int64, share: Int64) {
        #expect(EntryDetailText.split(kind: kind, total: total, share: share) == nil)
    }

    @Test("whenTheEntryIsRecent_EntryDetailTextDay_ShouldReadTodayYesterdayOrTheDateWithTheYearOnlyWhenNeeded")
    func day() throws {
        let today = try #require(CalendarDate(year: 2026, month: 11, day: 9))
        #expect(EntryDetailText.day(today, today: today) == "Today")
        #expect(EntryDetailText.day(today.adding(days: -1), today: today) == "Yesterday")
        let thisYear = try #require(CalendarDate(year: 2026, month: 9, day: 27))
        let lastYear = try #require(CalendarDate(year: 2025, month: 9, day: 27))
        #expect(!EntryDetailText.day(thisYear, today: today).contains("2026"))
        #expect(EntryDetailText.day(lastYear, today: today).contains("2025"))
    }

    @Test("whenMoreThanAHundredPeopleWouldBeNeeded_EntryDetailText_ShouldReadCustomShare")
    func tooManyPeople() {
        #expect(EntryDetailText.split(kind: .expense, total: 10_100, share: 1)?.method == "Custom share")
    }
}
