namespace Penny.Backend.Application.Abstractions.Persistence;

// Receipt text rows by status, plus receipts without a row and finished rows made by
// another engine or language set (`receipts-ocr` re-runs those).
public sealed record ReceiptTextStatusReport(
    long Receipts,
    long Missing,
    long Pending,
    long Done,
    long Failed,
    long Unsupported,
    long OtherEngine
);
