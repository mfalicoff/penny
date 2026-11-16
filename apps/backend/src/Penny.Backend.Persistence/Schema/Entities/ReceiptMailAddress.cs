namespace Penny.Backend.Persistence.Schema.Entities;

// A private receipt address (MAZ-184, docs/plans/email-receipts.md#5-addresses). Only
// the SHA-256 of the local part is searchable; the full address and the allowed
// senders (a JSON array) are sealed with the inbound mail scheme (InboundMailSealer).
// A user has at most one row with `RevokedAt` null; it is live until `ExpiresAt`.
public sealed class ReceiptMailAddress
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string LocalPartHash { get; set; }
    public short EncryptionVersion { get; set; } = 1;
    public required byte[] KeySalt { get; set; }
    public required byte[] AddressNonce { get; set; }
    public required byte[] AddressEncrypted { get; set; }
    public required byte[] AllowedSendersNonce { get; set; }
    public required byte[] AllowedSendersEncrypted { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset? LastReceivedAt { get; set; }
}
