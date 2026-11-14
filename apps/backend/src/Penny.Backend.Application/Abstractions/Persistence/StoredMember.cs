namespace Penny.Backend.Application.Abstractions.Persistence;

// A member's latest membership period: the last join instant, its local join day (when
// the client sent an offset) and, for a former member, when they left.
public sealed record StoredMember(
    string UserId,
    string Email,
    DateTimeOffset JoinedAt,
    DateOnly? JoinedOn,
    DateTimeOffset? LeftAt
)
{
    public bool IsCurrent => LeftAt is null;
}
