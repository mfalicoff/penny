namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredEntry(
    string Id,
    string Title,
    string Kind,
    long TotalCents,
    long ShareCents,
    int? Participants,
    string CategoryId,
    string? AccountId,
    string? TripId,
    DateOnly Date,
    string Note,
    string? ReceiptId,
    string? RecurringId,
    // Contract 2.4.0 (MAZ-151): all four of the first set, or none; RateDate unless edited.
    long? OriginalAmount,
    string? OriginalCurrency,
    string? Rate,
    string? RateStatus,
    DateOnly? RateDate
);
