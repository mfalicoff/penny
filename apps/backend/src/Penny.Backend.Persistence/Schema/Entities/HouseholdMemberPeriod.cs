namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdMemberPeriod
{
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public required string UserId { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
    public DateOnly? JoinedOn { get; set; }
    public DateTimeOffset? LeftAt { get; set; }
}
