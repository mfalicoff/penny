namespace Penny.Backend.Application.Abstractions.Persistence;

// The final state of one extraction: `Status` is done, failed or unsupported. A done
// result carries the cleaned text, its normalized search text and the chunks to embed;
// failed and unsupported results carry a failure code and no text.
public sealed record ReceiptTextResult(
    string ReceiptId,
    string Status,
    string? Method,
    string Engine,
    string Content,
    string SearchText,
    int? Pages,
    string? Failure,
    int Attempts,
    DateTimeOffset ExtractedAt,
    IReadOnlyList<string> Chunks
);
