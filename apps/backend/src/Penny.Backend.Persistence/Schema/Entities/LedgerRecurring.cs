namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerRecurring
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Title { get; set; }
    public required string Kind { get; set; }
    public long TotalCents { get; set; }
    public long ShareCents { get; set; }
    public required string CategoryId { get; set; }
    public string? AccountId { get; set; }
    public DateOnly StartDate { get; set; }
    public required string Note { get; set; }
    public required string Frequency { get; set; }
    public DateOnly NextDate { get; set; }
    public short AnchorDay { get; set; }
    public bool Active { get; set; }
}
