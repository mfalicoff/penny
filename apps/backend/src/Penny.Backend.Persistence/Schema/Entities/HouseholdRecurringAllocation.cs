namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdRecurringAllocation
{
    public required string RecurringId { get; set; }
    public required string UserId { get; set; }
    public long? AmountCents { get; set; }
    public int? PercentBasisPoints { get; set; }
}
