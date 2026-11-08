namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class PushDelivery
{
    public required string OutboxId { get; set; }
    public required string Token { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public string? TicketId { get; set; }
    public DateTimeOffset? ReceiptCheckedAt { get; set; }
    public string? LeaseOwner { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
