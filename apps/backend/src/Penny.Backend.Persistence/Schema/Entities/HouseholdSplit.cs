namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdSplit
{
    public required string ExpenseId { get; set; }
    public required string UserId { get; set; }
    public long AmountCents { get; set; }
}
