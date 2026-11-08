namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class Receipt
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string StoragePath { get; set; }
    public required byte[] KeySalt { get; set; }
    public required byte[] FileNonce { get; set; }
    public required byte[] NameNonce { get; set; }
    public required byte[] NameEncrypted { get; set; }
    public required string Mime { get; set; }
    public long SizeBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
