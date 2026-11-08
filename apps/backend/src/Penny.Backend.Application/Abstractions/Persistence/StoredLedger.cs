namespace Penny.Backend.Application.Abstractions.Persistence;

// Typed v4 personal ledger. The API layer (MAZ-55) maps it to/from the v4 document.
public sealed record StoredLedger(
    long Revision,
    string Currency,
    IReadOnlyList<StoredAccount> Accounts,
    IReadOnlyList<StoredCategory> Categories,
    IReadOnlyList<StoredTrip> Trips,
    IReadOnlyList<StoredRecurring> Recurring,
    IReadOnlyList<StoredEntry> Entries
);
