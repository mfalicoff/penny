namespace Penny.Backend.Persistence.Receipts;

// A file in the receipt root, relative to it. `Temporary` files are unfinished writes.
public sealed record ReceiptStoreFile(string StoragePath, bool Temporary, DateTimeOffset Modified);
