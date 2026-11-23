namespace Penny.Backend.Application.Abstractions.Persistence;

// A live invite code: the household's shared code, or an emailed invitation's code
// (`EmailInviteId`), which joins once.
public sealed record StoredInvite(
    string HouseholdId,
    DateTimeOffset ExpiresAt,
    string? EmailInviteId = null
);
