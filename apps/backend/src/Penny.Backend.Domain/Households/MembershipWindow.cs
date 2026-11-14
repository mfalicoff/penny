namespace Penny.Backend.Domain.Households;

// One membership period as calendar days: the member takes
// part in expenses dated from `JoinedOn` up to, but excluding, `LeftOn`.
public sealed record MembershipWindow(string UserId, DateOnly JoinedOn, DateOnly? LeftOn)
{
    // The recorded local join day, otherwise the join instant shifted by the
    // caller's offset (UTC when the join recorded none). The
    // departure day is the UTC day of the leave instant.
    public static MembershipWindow From(
        string userId,
        DateTimeOffset joinedAt,
        DateOnly? joinedOn,
        DateTimeOffset? leftAt,
        int offsetMinutes
    ) =>
        new(
            userId,
            joinedOn ?? MembershipDates.JoinedOn(joinedAt, offsetMinutes)!.Value,
            leftAt is { } left ? DateOnly.FromDateTime(left.UtcDateTime) : null
        );

    // Distinct members active on `date`, ordered by id.
    public static IReadOnlyList<string> ActiveOn(
        IEnumerable<MembershipWindow> windows,
        DateOnly date
    ) =>
        [
            .. windows
                .Where(window =>
                    window.JoinedOn <= date && (window.LeftOn is not { } left || date < left)
                )
                .Select(window => window.UserId)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal),
        ];
}
