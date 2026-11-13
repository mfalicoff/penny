using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.UnitTests.Search;

// The embedding outbox contract of ISearchRepository, in memory, for worker tests.
internal sealed class InMemorySearchOutbox : ISearchRepository
{
    public Dictionary<
        long,
        (string Passage, DateTimeOffset? Due, int Attempts, string? Lease, float[]? Vector)
    > Rows { get; } = [];

    public Task<IReadOnlyList<EmbeddingWork>> ClaimEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    )
    {
        var claimed = Rows.Where(row => row.Value.Due <= now && row.Value.Lease is null)
            .OrderBy(row => row.Value.Due)
            .ThenBy(row => row.Key)
            .Take(limit)
            .ToList();
        foreach (var (id, row) in claimed)
            Rows[id] = row with { Lease = leaseToken };
        return Task.FromResult<IReadOnlyList<EmbeddingWork>>([
            .. claimed.Select(row => new EmbeddingWork(
                row.Key,
                row.Value.Passage,
                row.Value.Attempts,
                row.Value.Due!.Value
            )),
        ]);
    }

    public Task<int> CompleteEmbeddingsAsync(
        string leaseToken,
        string modelId,
        IReadOnlyList<EmbeddingResult> results,
        CancellationToken cancellationToken
    )
    {
        var stored = 0;
        foreach (var result in results)
            if (
                Rows[result.DocumentId] is var row
                && row.Lease == leaseToken
                && row.Passage == result.Passage
            )
            {
                Rows[result.DocumentId] = row with
                {
                    Due = null,
                    Attempts = 0,
                    Lease = null,
                    Vector = result.Vector,
                };
                stored++;
            }
        return Task.FromResult(stored);
    }

    public Task ReleaseEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset retryAt,
        CancellationToken cancellationToken
    )
    {
        foreach (var (id, row) in Rows.Where(row => row.Value.Lease == leaseToken).ToList())
            Rows[id] = row with { Due = retryAt, Attempts = row.Attempts + 1, Lease = null };
        return Task.CompletedTask;
    }

    public Task<long> PendingEmbeddingsAsync(CancellationToken cancellationToken) =>
        Task.FromResult((long)Rows.Count(row => row.Value.Due is not null));

    // Searches find nothing; their criteria are recorded.
    public List<SearchCriteria> Searches { get; } = [];

    public Task<StoredSearchPage> SearchAsync(
        SearchCriteria criteria,
        CancellationToken cancellationToken
    )
    {
        Searches.Add(criteria);
        return Task.FromResult(
            new StoredSearchPage(0, [], new Dictionary<string, StoredReceiptInfo>())
        );
    }

    public Task<SearchRebuildReport> RebuildAsync(
        string? userId,
        string modelId,
        Func<string, IReadOnlyList<string>> chunk,
        CancellationToken cancellationToken
    ) => throw new NotSupportedException();

    public Task<SearchVerifyReport> VerifyAsync(
        string? userId,
        string modelId,
        CancellationToken cancellationToken
    ) => throw new NotSupportedException();
}
