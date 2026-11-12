namespace Penny.Backend.Application.Abstractions.Persistence;

// Receipt text rows by status, plus linked receipts without a row (`receipts-ocr`
// queues those) and finished rows made by another engine or language set (it re-runs
// those).
public sealed record ReceiptTextStatusReport(
    long Receipts,
    long Missing,
    long Pending,
    long Done,
    long Failed,
    long Unsupported,
    long OtherEngine
);
