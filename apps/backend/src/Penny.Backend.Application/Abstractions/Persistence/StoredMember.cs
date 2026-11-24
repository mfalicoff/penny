namespace Penny.Backend.Application.Abstractions.Persistence;

// A member's latest membership period: the last join instant, its local join day (when
// the client sent an offset) and, for a former member, when they left. `DisplayName` and
// `AvatarVersion` are the member's profile (MAZ-171), shown to the household's members.
// `Deleted` (MAZ-152): the person deleted their account; clients show "Former member".
public sealed record StoredMember(
    string UserId,
    string Email,
    DateTimeOffset JoinedAt,
    DateOnly? JoinedOn,
    DateTimeOffset? LeftAt,
    string? DisplayName = null,
    string? AvatarVersion = null,
    bool Deleted = false
)
{
    public bool IsCurrent => LeftAt is null;
}
