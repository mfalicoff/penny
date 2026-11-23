namespace Penny.Backend.Application.Abstractions.Persistence;

// An invitation sent by email (MAZ-124). The code itself is never stored.
public sealed record StoredEmailInvite(
    string Id,
    string HouseholdId,
    string InvitedBy,
    string Email,
    DateTimeOffset CreatedAt,
    DateTimeOffset RequestedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? FailedAt,
    DateTimeOffset? JoinedAt,
    DateTimeOffset? RevokedAt
);
