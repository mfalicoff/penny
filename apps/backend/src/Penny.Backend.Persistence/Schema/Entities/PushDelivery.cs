namespace Penny.Backend.Persistence.Schema.Entities;

// One outbox message for one device token. `TicketId` is the APNs `apns-id` of an
// accepted send, kept for diagnostics. MAZ-61.
public sealed class PushDelivery
{
    public required string OutboxId { get; set; }
    public required string Token { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public string? TicketId { get; set; }
    public string? LastError { get; set; }
}
