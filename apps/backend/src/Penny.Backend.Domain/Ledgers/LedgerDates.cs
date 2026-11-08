using System.Globalization;

namespace Penny.Backend.Domain.Ledgers;

// Calendar dates without time zones, as the legacy `validDate`: strict `YYYY-MM-DD`
// with ASCII digits, a real calendar day, from 2000-01-01 through 2100-12-31.
public static class LedgerDates
{
    public const string Format = "yyyy-MM-dd";
    public static readonly DateOnly Min = new(2000, 1, 1);
    public static readonly DateOnly Max = new(2100, 12, 31);

    public static bool TryParse(string value, out DateOnly date)
    {
        date = default;
        if (value.Length != 10 || value[4] != '-' || value[7] != '-')
            return false;
        for (var index = 0; index < value.Length; index++)
            if (index is not (4 or 7) && !char.IsAsciiDigit(value[index]))
                return false;
        return DateOnly.TryParseExact(
                value,
                Format,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out date
            )
            && date >= Min
            && date <= Max;
    }

    public static string Write(DateOnly date) =>
        date.ToString(Format, CultureInfo.InvariantCulture);
}
