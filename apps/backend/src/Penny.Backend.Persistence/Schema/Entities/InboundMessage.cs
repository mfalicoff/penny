namespace Penny.Backend.Persistence.Schema.Entities;

// One raw message accepted by the signed ingress endpoint (MAZ-184). The raw MIME is
// sealed under `StoragePath` (below the receipt root's `inbound/` directory) until it
// is processed; the path is cleared once the file is deleted. `Sha256` (of the raw
// bytes) de-duplicates resends per user. Authentication results are read from the
// ingress' own header when the message is parsed, so they are null while pending.
public sealed class InboundMessage
{
    public required string Id { get; set; }
    public required string AddressId { get; set; }
    public required string UserId { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public long SizeBytes { get; set; }
    public required string Sha256 { get; set; }
    public string? AuthSpf { get; set; }
    public string? AuthDkim { get; set; }
    public string? AuthDmarc { get; set; }
    public required string Status { get; set; }
    public string? ReasonCode { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public string? StoragePath { get; set; }
    public short EncryptionVersion { get; set; } = 1;
    public required byte[] KeySalt { get; set; }
    public required byte[] FileNonce { get; set; }
}
