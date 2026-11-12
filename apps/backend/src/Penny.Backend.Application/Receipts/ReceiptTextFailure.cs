namespace Penny.Backend.Application.Receipts;

// Fixed failure codes stored in `receipt_texts.failure` and used as telemetry values.
// They never contain receipt content, file names or engine output.
public static class ReceiptTextFailure
{
    public const string TooLarge = "too-large";
    public const string UnsupportedFormat = "unsupported-format";
    public const string Unreadable = "unreadable";
    public const string Corrupt = "corrupt";
    public const string Timeout = "timeout";
    public const string EngineError = "engine-error";

    // An engine program was killed by its memory or CPU limit.
    public const string ResourceLimit = "resource-limit";

    // A worker claimed the receipt for its last attempt and never finished it (it
    // crashed or was killed, e.g. by the host's out-of-memory killer).
    public const string LeaseExpired = "lease-expired";

    // Not a failure: on a `done` row, an image or page was taller than the engine's
    // pixel ceiling and only its top part was read.
    public const string Truncated = "truncated";

    public static readonly IReadOnlyList<string> All =
    [
        TooLarge,
        UnsupportedFormat,
        Unreadable,
        Corrupt,
        Timeout,
        EngineError,
        ResourceLimit,
        LeaseExpired,
        Truncated,
    ];
}
