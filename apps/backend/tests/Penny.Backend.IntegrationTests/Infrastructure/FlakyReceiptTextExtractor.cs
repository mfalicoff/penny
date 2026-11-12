using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Fails the first `failures` extractions with an engine error, then delegates to the
// real engine: retries and backoff without depending on a broken installation.
public sealed class FlakyReceiptTextExtractor(IReceiptTextExtractor inner, int failures)
    : IReceiptTextExtractor
{
    private int remaining = failures;

    public int Calls { get; private set; }

    public string Engine => inner.Engine;

    public bool Supports(string mime) => inner.Supports(mime);

    public Task<ReceiptExtraction> ExtractAsync(
        string mime,
        ReadOnlyMemory<byte> content,
        int maxPages,
        CancellationToken cancellationToken
    )
    {
        Calls++;
        if (remaining-- > 0)
            throw new ReceiptExtractionException(ReceiptTextFailure.EngineError);
        return inner.ExtractAsync(mime, content, maxPages, cancellationToken);
    }
}
