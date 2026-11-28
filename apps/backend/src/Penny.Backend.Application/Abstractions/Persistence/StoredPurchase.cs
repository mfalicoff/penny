namespace Penny.Backend.Application.Abstractions.Persistence;

// One purchase captured on a device (Apple Pay, MAZ-291), in its owner's Inbox. `Amount`
// is in minor units of `Currency`. `Status` is to_review until it is triaged; `Outcome`
// then says how (added, attached or discarded), with the entry it became or joined.
public sealed record StoredPurchase(
    string Id,
    string Merchant,
    long Amount,
    string Currency,
    string? Card,
    DateTimeOffset CapturedAt,
    DateTimeOffset CreatedAt,
    string Status,
    string? Outcome,
    string? EntryId,
    string? HouseholdId,
    DateTimeOffset? ResolvedAt
);
