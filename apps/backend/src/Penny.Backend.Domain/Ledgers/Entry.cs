namespace Penny.Backend.Domain.Ledgers;

// A personal transaction. Amounts are integer cents and dates are calendar dates.
// A null optional field is absent from the document; JSON null is never accepted.
public sealed record Entry(
    string Id,
    string Title,
    string Kind,
    long Total,
    long Share,
    int? Participants,
    string CategoryId,
    string? AccountId,
    string? TripId,
    DateOnly Date,
    string Note,
    ReceiptLink? Receipt,
    string? RecurringId,
    // Contract 2.4.0: the amount paid in another currency and the rate used; null for an
    // entry in the home currency.
    ForeignAmount? Foreign
);
