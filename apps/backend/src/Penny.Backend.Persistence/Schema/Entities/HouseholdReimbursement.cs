namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdReimbursement
{
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public required string Month { get; set; }
    public required string FromUserId { get; set; }
    public required string ToUserId { get; set; }
    public long AmountCents { get; set; }
    public string? ExpenseId { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
