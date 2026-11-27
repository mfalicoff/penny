namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerEntry
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Title { get; set; }
    public required string Kind { get; set; }
    public long TotalCents { get; set; }
    public long ShareCents { get; set; }
    public int? Participants { get; set; }
    public required string CategoryId { get; set; }
    public string? AccountId { get; set; }
    public string? TripId { get; set; }
    public DateOnly EntryDate { get; set; }
    public required string Note { get; set; }
    public string? ReceiptId { get; set; }
    public string? RecurringId { get; set; }

    // Contract 2.4.0 (MAZ-151): an entry paid in another currency; all four or none, plus
    // the publication date unless the rate was edited.
    public long? OriginalAmount { get; set; }
    public string? OriginalCurrency { get; set; }
    public string? Rate { get; set; }
    public string? RateStatus { get; set; }
    public DateOnly? RateDate { get; set; }
}
