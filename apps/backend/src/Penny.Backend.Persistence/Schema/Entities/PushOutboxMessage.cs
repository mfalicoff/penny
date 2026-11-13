namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class PushOutboxMessage
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string HouseholdId { get; set; }
    public required string EventType { get; set; }
    public required string EntityId { get; set; }
    public required string Payload { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public string? LastError { get; set; }
    public string? LeaseOwner { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
