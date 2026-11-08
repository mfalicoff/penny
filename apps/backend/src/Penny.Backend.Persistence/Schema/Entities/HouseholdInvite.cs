namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class HouseholdInvite
{
    public required string CodeHash { get; set; }
    public required string HouseholdId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}
