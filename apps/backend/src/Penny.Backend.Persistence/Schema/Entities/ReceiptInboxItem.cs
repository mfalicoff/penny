namespace Penny.Backend.Persistence.Schema.Entities;

// One processed message in its owner's receipt inbox (MAZ-184). The subject and the
// sender are sealed with the inbound mail scheme, because a subject can be personal.
// `Status` is maintained by the server from the links of the item's receipts.
public sealed class ReceiptInboxItem
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string InboundMessageId { get; set; }
    public short EncryptionVersion { get; set; } = 1;
    public required byte[] KeySalt { get; set; }
    public required byte[] SubjectNonce { get; set; }
    public required byte[] SubjectEncrypted { get; set; }
    public required byte[] FromNonce { get; set; }
    public required byte[] FromEncrypted { get; set; }
    public bool SenderVerified { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset? AttachedAt { get; set; }

    // When the item last went back to To attach because a receipt lost its last link.
    // Unhandled items expire `InboundMail__InboxRetentionDays` after the later of this
    // and `ReceivedAt`; `ExpiresAt` is that deadline as first set.
    public DateTimeOffset? ReturnedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
