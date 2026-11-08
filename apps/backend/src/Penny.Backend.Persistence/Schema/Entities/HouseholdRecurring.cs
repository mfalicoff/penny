namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdRecurring
{
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public required string Title { get; set; }
    public long TotalCents { get; set; }
    public required string PayerId { get; set; }
    public required string SplitMode { get; set; }
    public required string CategoryName { get; set; }
    public required string CategoryIcon { get; set; }
    public required string CategoryColor { get; set; }
    public required string Note { get; set; }
    public string? AccountId { get; set; }
    public string? ReceiptId { get; set; }
    public required string Frequency { get; set; }
    public DateOnly NextDate { get; set; }
    public short AnchorDay { get; set; }
    public bool Active { get; set; }
    public required string CreatedBy { get; set; }
    public long Revision { get; set; }
    public string? LeaseOwner { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
