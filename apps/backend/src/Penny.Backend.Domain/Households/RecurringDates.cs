namespace Penny.Backend.Domain.Households;

// Port of the legacy `nextOccurrence` (src/domain/ledger.ts): weekly adds seven days;
// monthly and yearly move to the first of the target month, then to the anchor day
// clamped to that month's length (Jan 31 -> Feb 28 -> Mar 31; Feb 29 -> Feb 28).
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
}
