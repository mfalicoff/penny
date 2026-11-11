namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class Receipt
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string StoragePath { get; set; }

    // How the file and name are sealed: the key derivation and the associated data (see
    // ReceiptFileStore). Every receipt is encrypted; there is no plaintext version.
    public short EncryptionVersion { get; set; } = 1;
    public required byte[] KeySalt { get; set; }
    public required byte[] FileNonce { get; set; }
    public required byte[] NameNonce { get; set; }
    public required byte[] NameEncrypted { get; set; }
    public required string Mime { get; set; }
    public long SizeBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
