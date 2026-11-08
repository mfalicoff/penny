namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredTrip(
    string Id,
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    string? SharedHouseholdId
);
