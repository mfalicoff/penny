using System.Globalization;
using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class RecurringDatesTests
{
    [Theory]
    // Monthly from Jan 31 keeps returning to the 31st after short months.
    [InlineData("2027-01-31", "monthly", 31, "2027-02-28,2027-03-31,2027-04-30,2027-05-31")]
    [InlineData("2028-01-31", "monthly", 31, "2028-02-29,2028-03-31,2028-04-30,2028-05-31")]
    [InlineData("2026-11-30", "monthly", 30, "2026-12-30,2027-01-30,2027-02-28,2027-03-30")]
    // Yearly from a leap day falls back to Feb 28 and returns in the next leap year.
    [InlineData("2028-02-29", "yearly", 29, "2029-02-28,2030-02-28,2031-02-28,2032-02-29")]
    [InlineData("2026-12-29", "weekly", 29, "2027-01-05,2027-01-12,2027-01-19,2027-01-26")]
    public void whenOccurrencesChain_Next_ShouldReturnToTheAnchorDay(
        string start,
        string frequency,
        int anchor,
        string expected
    )
    {
        var dates = new List<string>();
        var date = Day(start);
        for (var i = 0; i < 4; i++)
        {
            date = RecurringDates.Next(date, frequency, anchor);
            dates.Add(Text(date));
        }
        string.Join(',', dates).ShouldBe(expected);
    }

    [Theory]
    // An edit that keeps the advanced next date and frequency keeps the original anchor.
    [InlineData("2027-02-28", "monthly", "2027-02-28", "monthly", 31, 31)]
    // A new next date sets the anchor to its day.
    [InlineData("2027-03-15", "monthly", "2027-02-28", "monthly", 31, 15)]
    // A frequency change starts from the next date's day.
    [InlineData("2027-02-28", "yearly", "2027-02-28", "monthly", 31, 28)]
    public void whenRuleEdited_Anchor_ShouldKeepStoredAnchorOnlyForUnchangedSchedule(
        string nextDate,
        string frequency,
        string storedNextDate,
        string storedFrequency,
        int storedAnchor,
        int expected
    ) =>
        RecurringDates
            .Anchor(Day(nextDate), frequency, Day(storedNextDate), storedFrequency, storedAnchor)
            .ShouldBe(expected);

    [Theory]
    [InlineData("2027-01-31", "monthly", 31, "2027-06-10", "2027-06-30")]
    [InlineData("2027-01-31", "monthly", 31, "2027-01-31", "2027-01-31")]
    [InlineData("2027-01-31", "monthly", 31, "2026-12-01", "2027-01-31")]
    [InlineData("2028-02-29", "yearly", 29, "2031-03-01", "2032-02-29")]
    [InlineData("2027-01-01", "weekly", 1, "2027-01-09", "2027-01-15")]
    public void whenResumed_FirstOnOrAfter_ShouldSkipPausedOccurrencesAndKeepAnchor(
        string nextDate,
        string frequency,
        int anchor,
        string today,
        string expected
    ) =>
        Text(RecurringDates.FirstOnOrAfter(Day(nextDate), frequency, anchor, Day(today)))
            .ShouldBe(expected);

    private static DateOnly Day(string value) =>
        DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Text(DateOnly value) =>
        value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
