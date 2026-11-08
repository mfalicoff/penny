namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class Household
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Currency { get; set; }
    public required string CreatorId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public DateOnly? TripStart { get; set; }
    public DateOnly? TripEnd { get; set; }
}
