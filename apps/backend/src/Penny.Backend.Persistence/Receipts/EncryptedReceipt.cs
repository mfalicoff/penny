using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Receipts;

// Metadata row plus ciphertext||tag that has not been written to disk yet.
public sealed record EncryptedReceipt(Receipt Row, byte[] Ciphertext);
