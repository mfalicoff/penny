namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdAuditEntry
{
    public long SortOrder { get; set; }
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public string? ExpenseId { get; set; }
    public required string ActorId { get; set; }
    public required string Action { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
