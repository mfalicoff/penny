namespace Penny.Backend.Application.Receipts;

// The state of a receipt's extracted text (`receipt_texts.status`, MAZ-125).
public static class ReceiptTextStatus
{
    // Queued (new upload, link, backfill or retry after a failed attempt).
    public const string Pending = "pending";

    // Text extracted (possibly empty: a photo without readable text).
    public const string Done = "done";

    // Every attempt failed (corrupt or unreadable file, timeouts, engine errors).
    public const string Failed = "failed";

    // Not extractable by design: a type the engine cannot read (HEIC/HEIF) or a file
    // over the size limit. Never retried unless the engine changes.
    public const string Unsupported = "unsupported";

    public static readonly IReadOnlyList<string> All = [Pending, Done, Failed, Unsupported];
}
