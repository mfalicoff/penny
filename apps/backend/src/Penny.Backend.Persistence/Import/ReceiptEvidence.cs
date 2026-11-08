namespace Penny.Backend.Persistence.Import;

// Plaintext identity of a receipt: compared between source and decrypted target.
internal sealed record ReceiptEvidence(
    string Id,
    string UserId,
    string Name,
    string Mime,
    long SizeBytes,
    string ContentSha256
);
