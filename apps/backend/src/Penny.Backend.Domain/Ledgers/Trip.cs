namespace Penny.Backend.Domain.Ledgers;

public sealed record Trip(
    string Id,
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    string? SharedHouseholdId,
    // A personal trip's currency, the default for its new entries (contract 2.6.0).
    string? Currency = null
);
