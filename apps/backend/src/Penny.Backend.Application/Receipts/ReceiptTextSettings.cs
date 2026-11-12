namespace Penny.Backend.Application.Receipts;

// Bounds of one extraction (MAZ-125): receipts over `MaxBytes` are unsupported, only
// the first `MaxPages` PDF pages are read, one receipt may take at most `Timeout`, at
// most `Concurrency` receipts are extracted at once per process and a receipt is
// failed after `MaxAttempts` failed attempts. Stored text is capped at
// `MaxTextLength` UTF-16 units and split into at most `MaxChunks` embedding chunks.
public sealed record ReceiptTextSettings(
    long MaxBytes,
    int MaxPages,
    TimeSpan Timeout,
    int Concurrency,
    int MaxAttempts,
    int MaxTextLength = 100_000,
    int MaxChunks = 32
)
{
    public static readonly ReceiptTextSettings Default = new(
        10 * 1024 * 1024,
        10,
        TimeSpan.FromSeconds(120),
        1,
        4
    );

    // The lease outlives the time bound, so a live worker never loses its row.
    public TimeSpan Lease => Timeout + TimeSpan.FromMinutes(1);
}
