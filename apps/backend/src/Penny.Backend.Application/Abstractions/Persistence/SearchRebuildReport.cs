namespace Penny.Backend.Application.Abstractions.Persistence;

// `search-rebuild`: documents written, removed and queued for embedding (receipt
// chunks included), and stored receipt texts whose normalized text or chunks were
// recomputed (MAZ-125; OCR itself is not re-run).
public sealed record SearchRebuildReport(
    long Written,
    long Removed,
    long Queued,
    long ReceiptTexts
);
