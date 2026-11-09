namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredInvite(string HouseholdId, DateTimeOffset ExpiresAt);
