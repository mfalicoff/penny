namespace Penny.Backend.Domain.Households;

// One membership period as calendar days (legacy `HouseholdMember`): the member takes
// part in expenses dated from `JoinedOn` up to, but excluding, `LeftOn`.
public sealed record MembershipWindow(string UserId, DateOnly JoinedOn, DateOnly? LeftOn)
{
    // Legacy `membershipPeriods`: the recorded local join day, otherwise the join
    // instant shifted by the caller's offset (older clients sent none: UTC). The
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

    // Legacy `activeMemberIds`: distinct members active on `date`, ordered by id.
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
