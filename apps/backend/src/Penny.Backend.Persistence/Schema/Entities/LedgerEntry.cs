namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerEntry
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Title { get; set; }
    public required string Kind { get; set; }
    public long TotalCents { get; set; }
    public long ShareCents { get; set; }
    public required string CategoryId { get; set; }
    public string? AccountId { get; set; }
    public string? TripId { get; set; }
    public DateOnly EntryDate { get; set; }
    public required string Note { get; set; }
    public string? ReceiptId { get; set; }
    public string? RecurringId { get; set; }
}
