using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Application.Search;

// Drains the embedding outbox: writes queue documents in their own transaction; this
// service leases a batch, embeds the passages on the CPU and stores the vectors only
// if each passage is still the one it embedded. Failures release the lease with
// exponential backoff. Any number of workers may run: leases never overlap.
public sealed class SearchEmbeddingService(
    ISearchRepository search,
    ITextEmbedder embedder,
    TimeProvider clock
)
{
    public const int BatchSize = 32;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(10);

    // Processes at most one batch and returns how many rows it claimed.
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        var token = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var now = clock.GetUtcNow();
        var work = await search.ClaimEmbeddingsAsync(
            token,
            now,
            now + Lease,
            BatchSize,
            cancellationToken
        );
        if (work.Count == 0)
            return 0;
        using var activity = BackendTelemetry.StartJob(
            BackendTelemetry.SearchEmbeddingJob,
            work.Count
        );
        foreach (var item in work)
            BackendTelemetry.JobPickedUp(BackendTelemetry.SearchEmbeddingJob, now - item.DueAt);
        IReadOnlyList<float[]> vectors;
        try
        {
            vectors = embedder.EmbedPassages([.. work.Select(item => item.Passage)]);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            BackendTelemetry.Failed(activity, error.GetType().Name);
            var attempts = work.Max(item => item.Attempts);
            await search.ReleaseEmbeddingsAsync(
                token,
                clock.GetUtcNow() + Backoff(attempts),
                CancellationToken.None
            );
            throw;
        }
        await search.CompleteEmbeddingsAsync(
            token,
            embedder.ModelId,
            [
                .. work.Select(
                    (item, index) =>
                        new EmbeddingResult(item.DocumentId, item.Passage, vectors[index])
                ),
            ],
            cancellationToken
        );
        return work.Count;
    }

    // Runs batches until nothing is due (maintenance commands and tests).
    public async Task<long> CatchUpAsync(CancellationToken cancellationToken)
    {
        long total = 0;
        int claimed;
        while ((claimed = await RunOnceAsync(cancellationToken)) > 0)
            total += claimed;
        return total;
    }

    // 2^attempts seconds, at most MaxBackoff.
    public static TimeSpan Backoff(int attempts) =>
        TimeSpan.FromSeconds(
            Math.Min(Math.Pow(2, Math.Min(attempts, 20)), MaxBackoff.TotalSeconds)
        );
}
