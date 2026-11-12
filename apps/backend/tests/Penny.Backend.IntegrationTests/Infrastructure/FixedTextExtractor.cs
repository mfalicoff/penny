using Penny.Backend.Application.Abstractions.Receipts;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Returns the same text for every receipt, as embedded PDF text: storage and chunk
// behaviour without depending on what OCR reads.
public sealed class FixedTextExtractor(string text) : IReceiptTextExtractor
{
    public string Engine => "fixed 1.0";

    public bool Supports(string mime) => true;

    public Task<ReceiptExtraction> ExtractAsync(
        string mime,
        ReadOnlyMemory<byte> content,
        int maxPages,
        CancellationToken cancellationToken
    ) => Task.FromResult(new ReceiptExtraction(text, "text", 1));
}
