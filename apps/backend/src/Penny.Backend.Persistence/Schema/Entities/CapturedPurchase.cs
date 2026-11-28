namespace Penny.Backend.Persistence.Schema.Entities;

// One purchase captured on a device (Apple Pay, MAZ-291), waiting in its owner's Inbox
// until it is triaged. `Amount` is in minor units of `Currency`. The merchant and card
// are what the entry's title and account come from, so they are stored like entry text.
public sealed class CapturedPurchase
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string IdempotencyKey { get; set; }
    public required string Merchant { get; set; }
    public long Amount { get; set; }
    public required string Currency { get; set; }
    public string? Card { get; set; }
    public DateTimeOffset CapturedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    // to_review until triaged, then done with an outcome (added, attached, discarded).
    public required string Status { get; set; }
    public string? Outcome { get; set; }
    public string? EntryId { get; set; }
    public string? HouseholdId { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}
