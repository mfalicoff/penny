namespace Penny.Backend.Domain.Ledgers;

// A personal transaction. Amounts are integer cents and dates are calendar dates.
// A null optional field is absent from the document; JSON null is never accepted.
public sealed record Entry(
    string Id,
    string Title,
    string Kind,
    long Total,
    long Share,
    string CategoryId,
    string? AccountId,
    string? TripId,
    DateOnly Date,
    string Note,
    ReceiptLink? Receipt,
    string? RecurringId
);
