namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerTrip
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Name { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public string? SharedHouseholdId { get; set; }

    // The trip's currency (contract 2.6.0); null when it has none.
    public string? Currency { get; set; }
}
