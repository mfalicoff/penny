namespace Penny.Backend.Domain.Households;

// The next occurrence of a recurring rule: weekly adds seven days;
// monthly and yearly move to the first of the target month, then to the anchor day
// clamped to that month's length (Jan 31 -> Feb 28 -> Mar 31; Feb 29 -> Feb 28 ->
// Feb 29 in the next leap year). The anchor is the rule's original day of month, so a
// clamped occurrence never shortens later ones.
public static class RecurringDates
{
    public static DateOnly Next(DateOnly date, string frequency, int anchorDay)
    {
        if (string.Equals(frequency, "weekly", StringComparison.Ordinal))
            return date.AddDays(7);
        var first = new DateOnly(date.Year, date.Month, 1).AddMonths(
            string.Equals(frequency, "yearly", StringComparison.Ordinal) ? 12 : 1
        );
        return first.AddDays(
            Math.Min(anchorDay, DateTime.DaysInMonth(first.Year, first.Month)) - 1
        );
    }

    // The anchor a rule write keeps: the stored anchor while the next date and the
    // frequency are unchanged (a rule advanced from Jan 31 to Feb 28 still anchors on
    // the 31st), otherwise the day of the new next date.
    public static int Anchor(
        DateOnly nextDate,
        string frequency,
        DateOnly storedNextDate,
        string storedFrequency,
        int storedAnchorDay
    ) =>
        nextDate == storedNextDate
        && string.Equals(frequency, storedFrequency, StringComparison.Ordinal)
            ? storedAnchorDay
            : nextDate.Day;

    // The first occurrence on or after `today`, following the anchor from `nextDate`
    // (`nextDate` itself when it is not in the past). Resuming a paused rule skips the
    // occurrences that fell due while it was paused.
    public static DateOnly FirstOnOrAfter(
        DateOnly nextDate,
        string frequency,
        int anchorDay,
        DateOnly today
    )
    {
        var date = nextDate;
        while (date < today)
            date = Next(date, frequency, anchorDay);
        return date;
    }
}
