namespace Penny.Backend.Persistence.Schema.Entities;

// One outbox message for one device token. `Provider` is the device's transport when
// the delivery was planned (`expo` for imported rows); `TicketId` is the Expo ticket
// or the APNs `apns-id`; only Expo tickets wait for a receipt check. MAZ-61.
public sealed class PushDelivery
{
    public required string OutboxId { get; set; }
    public required string Token { get; set; }
    public string Provider { get; set; } = "expo";
    public DateTimeOffset? SentAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }
    public string? TicketId { get; set; }
    public DateTimeOffset? ReceiptCheckedAt { get; set; }
    public string? LastError { get; set; }
    public string? LeaseOwner { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
