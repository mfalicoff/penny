namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredRecurring(
    string Id,
    string Title,
    string Kind,
    long TotalCents,
    long ShareCents,
    string CategoryId,
    string? AccountId,
    DateOnly StartDate,
    string Note,
    string Frequency,
    DateOnly NextDate,
    short AnchorDay,
    bool Active
);
