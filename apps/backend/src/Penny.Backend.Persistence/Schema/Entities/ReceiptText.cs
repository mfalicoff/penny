namespace Penny.Backend.Persistence.Schema.Entities;

// The extracted text of one receipt (MAZ-125), stored unencrypted so it can be indexed
// (the receipt file stays encrypted). `Content` is the cleaned text, `SearchText` its
// normalized form for substring and typo matching. Rows with `DueAt` set are the
// extraction outbox, claimed with an expiring lease and retried with backoff. Deleted
// (with its chunks) when the last document or rule referencing the receipt lets go.
public sealed class ReceiptText
{
    public required string ReceiptId { get; set; }
    public required string Status { get; set; }

    // text (embedded PDF text), ocr or mixed; null until done.
    public string? Method { get; set; }

    // Engines, versions and OCR languages that produced the result.
    public string? Engine { get; set; }
    public string Content { get; set; } = "";
    public string SearchText { get; set; } = "";
    public int? Pages { get; set; }
    public string? Failure { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ExtractedAt { get; set; }
}
