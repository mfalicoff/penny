namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdExpense
{
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public required string Title { get; set; }
    public long TotalCents { get; set; }
    public DateOnly ExpenseDate { get; set; }
    public required string PayerId { get; set; }
    public required string SplitMode { get; set; }
    public required string CategoryName { get; set; }
    public required string CategoryIcon { get; set; }
    public required string CategoryColor { get; set; }
    public required string Note { get; set; }
    public string? AccountId { get; set; }
    public string? ReceiptId { get; set; }
    public string? RecurringId { get; set; }
    public long Revision { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string UpdatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
