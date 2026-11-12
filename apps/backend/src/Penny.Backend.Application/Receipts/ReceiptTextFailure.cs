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

    public static readonly IReadOnlyList<string> All =
    [
        TooLarge,
        UnsupportedFormat,
        Unreadable,
        Corrupt,
        Timeout,
        EngineError,
    ];
}
