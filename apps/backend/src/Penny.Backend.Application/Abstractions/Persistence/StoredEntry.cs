namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredEntry(
    string Id,
    string Title,
    string Kind,
    long TotalCents,
    long ShareCents,
    string CategoryId,
    string? AccountId,
    string? TripId,
    DateOnly Date,
    string Note,
    string? ReceiptId,
    string? RecurringId
);
