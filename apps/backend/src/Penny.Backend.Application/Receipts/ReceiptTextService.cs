using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Domain.Search;

namespace Penny.Backend.Application.Receipts;

// Extracts receipt text after upload (MAZ-125, docs/operations/receipt-ocr.md). The
// upload only queues a `receipt_texts` row; this service leases due rows, decrypts each
// receipt in memory, extracts its text with the local engine under the size, page and
// time bounds, and stores the cleaned text, its normalized search text and the chunks
// the embedding worker embeds next. Failed attempts are retried with exponential
// backoff until `MaxAttempts`. Nothing about the content is logged.
public sealed class ReceiptTextService(
    IReceiptTextRepository texts,
    IReceiptTextExtractor extractor,
    ITextEmbedder embedder,
    ReceiptTextSettings settings,
    TimeProvider clock
)
{
    public const string Retry = "retry";
    public static readonly TimeSpan FirstBackoff = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan MaxBackoff = TimeSpan.FromHours(1);

    public ReceiptTextSettings Settings => settings;

    // Claims at most `Concurrency` receipts, extracts them in parallel and returns how
    // many it claimed. The engine is checked before anything is claimed.
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        var engine = extractor.Engine;
        var token = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var now = clock.GetUtcNow();
        var work = await texts.ClaimAsync(
            token,
            now,
            now + settings.Lease,
            settings.Concurrency,
            cancellationToken
        );
        if (work.Count == 0)
            return 0;
        using var activity = BackendTelemetry.StartJob(BackendTelemetry.ReceiptTextJob, work.Count);
        foreach (var item in work)
            BackendTelemetry.JobPickedUp(BackendTelemetry.ReceiptTextJob, now - item.DueAt);
        await Task.WhenAll(
            work.Select(item => ProcessAsync(token, engine, item, cancellationToken))
        );
        return work.Count;
    }

    // Runs passes until nothing is due (maintenance commands and tests).
    public async Task<long> CatchUpAsync(CancellationToken cancellationToken)
    {
        long total = 0;
        int claimed;
        while ((claimed = await RunOnceAsync(cancellationToken)) > 0)
            total += claimed;
        return total;
    }

    // The embedding passages of cleaned text (also used by `search-rebuild`).
    public static IReadOnlyList<string> Chunks(
        string text,
        ITextEmbedder embedder,
        int maxChunks
    ) =>
        text.Length == 0
            ? []
            : ReceiptTextChunker.Split(
                text,
                embedder.CountPassageTokens,
                embedder.MaxTokens,
                maxChunks
            );

    // 30 seconds × 2^attempts, at most an hour.
    public static TimeSpan Backoff(int attempts) =>
        TimeSpan.FromSeconds(
            Math.Min(
                FirstBackoff.TotalSeconds * Math.Pow(2, Math.Min(attempts, 20)),
                MaxBackoff.TotalSeconds
            )
        );

    private async Task ProcessAsync(
        string token,
        string engine,
        ReceiptTextWork item,
        CancellationToken cancellationToken
    )
    {
        var started = clock.GetTimestamp();
        if (item.SizeBytes > settings.MaxBytes)
        {
            await FinishAsync(
                token,
                engine,
                item,
                ReceiptTextFailure.TooLarge,
                started,
                cancellationToken
            );
            return;
        }
        if (!extractor.Supports(item.Mime))
        {
            await FinishAsync(
                token,
                engine,
                item,
                ReceiptTextFailure.UnsupportedFormat,
                started,
                cancellationToken
            );
            return;
        }
        byte[]? content = null;
        try
        {
            try
            {
                content = await texts.ReadContentAsync(item.ReceiptId, cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                BackendTelemetry.JobFailed(BackendTelemetry.ReceiptTextJob, error.GetType().Name);
                await AttemptFailedAsync(
                    token,
                    engine,
                    item,
                    ReceiptTextFailure.Unreadable,
                    started,
                    cancellationToken
                );
                return;
            }
            ReceiptExtraction extraction;
            using (var bound = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                bound.CancelAfter(settings.Timeout);
                try
                {
                    extraction = await extractor.ExtractAsync(
                        item.Mime,
                        content,
                        settings.MaxPages,
                        bound.Token
                    );
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    await AttemptFailedAsync(
                        token,
                        engine,
                        item,
                        ReceiptTextFailure.Timeout,
                        started,
                        cancellationToken
                    );
                    return;
                }
                catch (ReceiptExtractionException error)
                {
                    await AttemptFailedAsync(
                        token,
                        engine,
                        item,
                        error.Failure,
                        started,
                        cancellationToken
                    );
                    return;
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    BackendTelemetry.JobFailed(
                        BackendTelemetry.ReceiptTextJob,
                        error.GetType().Name
                    );
                    await AttemptFailedAsync(
                        token,
                        engine,
                        item,
                        ReceiptTextFailure.EngineError,
                        started,
                        cancellationToken
                    );
                    return;
                }
            }
            var text = ReceiptTextCleaner.Clean(extraction.Text, settings.MaxTextLength);
            var chunks = Chunks(text, embedder, settings.MaxChunks);
            await texts.CompleteAsync(
                token,
                new ReceiptTextResult(
                    item.ReceiptId,
                    ReceiptTextStatus.Done,
                    extraction.Method,
                    engine,
                    text,
                    SearchText.Normalize(text),
                    extraction.Pages,
                    null,
                    item.Attempts,
                    clock.GetUtcNow(),
                    chunks
                ),
                cancellationToken
            );
            BackendTelemetry.ReceiptTextExtracted(
                ReceiptTextStatus.Done,
                extraction.Method,
                clock.GetElapsedTime(started)
            );
        }
        finally
        {
            if (content is not null)
                CryptographicOperations.ZeroMemory(content);
        }
    }

    // A file the engine will never read: unsupported, without retries.
    private async Task FinishAsync(
        string token,
        string engine,
        ReceiptTextWork item,
        string failure,
        long started,
        CancellationToken cancellationToken
    )
    {
        await texts.CompleteAsync(
            token,
            Ended(item, ReceiptTextStatus.Unsupported, engine, failure, item.Attempts),
            cancellationToken
        );
        BackendTelemetry.ReceiptTextExtracted(
            ReceiptTextStatus.Unsupported,
            null,
            clock.GetElapsedTime(started)
        );
    }

    // Retried with backoff until the last attempt, which fails the receipt.
    private async Task AttemptFailedAsync(
        string token,
        string engine,
        ReceiptTextWork item,
        string failure,
        long started,
        CancellationToken cancellationToken
    )
    {
        var attempts = item.Attempts + 1;
        if (attempts >= settings.MaxAttempts)
        {
            await texts.CompleteAsync(
                token,
                Ended(item, ReceiptTextStatus.Failed, engine, failure, attempts),
                cancellationToken
            );
            BackendTelemetry.ReceiptTextExtracted(
                ReceiptTextStatus.Failed,
                null,
                clock.GetElapsedTime(started)
            );
            return;
        }
        await texts.RetryAsync(
            token,
            item.ReceiptId,
            clock.GetUtcNow() + Backoff(item.Attempts),
            failure,
            cancellationToken
        );
        BackendTelemetry.ReceiptTextExtracted(Retry, null, clock.GetElapsedTime(started));
    }

    private ReceiptTextResult Ended(
        ReceiptTextWork item,
        string status,
        string engine,
        string failure,
        int attempts
    ) =>
        new(
            item.ReceiptId,
            status,
            null,
            engine,
            "",
            "",
            null,
            failure,
            attempts,
            clock.GetUtcNow(),
            []
        );
}
