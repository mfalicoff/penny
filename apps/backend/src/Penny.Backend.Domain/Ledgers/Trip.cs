namespace Penny.Backend.Domain.Ledgers;

public sealed record Trip(
    string Id,
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    string? SharedHouseholdId
);
