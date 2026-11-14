namespace Penny.Backend.Domain.Households;

// Membership instants are whole milliseconds. A join also records the
// member's local calendar day when the client sends its offset, so an expense dated
// that local day can include them even after UTC midnight.
public static class MembershipDates
{
    public const int MinOffsetMinutes = -840;
    public const int MaxOffsetMinutes = 720;

    // The API and storage use whole milliseconds.
    public static DateTimeOffset Truncate(DateTimeOffset instant) =>
        DateTimeOffset.FromUnixTimeMilliseconds(instant.ToUnixTimeMilliseconds());

    // The client's offset is `Date#getTimezoneOffset()` minutes, positive west of UTC.
    // Without an offset no local join day is recorded.
    public static DateOnly? JoinedOn(DateTimeOffset instant, int? timezoneOffsetMinutes) =>
        timezoneOffsetMinutes is { } offset
            ? DateOnly.FromDateTime(instant.UtcDateTime.AddMinutes(-offset))
            : null;
}
