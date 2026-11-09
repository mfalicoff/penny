namespace Penny.Backend.Application.Abstractions.Persistence;

// Search storage (MAZ-121). Documents are written by the ledger and shared-expense
// writers inside their own transactions; this port reads them, runs the embedding
// outbox and serves the maintenance commands.
public interface ISearchRepository
{
    // One consistent snapshot: authorization, matching, count and page. Throws
    // BackendFailure(Unavailable) when the statement timeout cancels the query.
    Task<StoredSearchPage> SearchAsync(
        SearchCriteria criteria,
        CancellationToken cancellationToken
    );

    // Leases up to `limit` due outbox rows to `leaseToken` until `leaseUntil`. Rows
    // leased to another live worker are skipped, so two workers never share a row.
    Task<IReadOnlyList<EmbeddingWork>> ClaimEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    );

    // Stores embeddings still leased to `leaseToken` whose passage is unchanged and
    // clears them from the outbox; returns how many were stored.
    Task<int> CompleteEmbeddingsAsync(
        string leaseToken,
        string modelId,
        IReadOnlyList<EmbeddingResult> results,
        CancellationToken cancellationToken
    );

    // Gives up the lease after a failure: the rows are retried at `retryAt`.
    Task ReleaseEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset retryAt,
        CancellationToken cancellationToken
    );

    // Outbox rows still owed an embedding (due now or later).
    Task<long> PendingEmbeddingsAsync(CancellationToken cancellationToken);

    // Recomputes every document of one user (personal entries and the shared expenses
    // of households they joined) or of everyone, and queues embeddings that are
    // missing or made by another model.
    Task<SearchRebuildReport> RebuildAsync(
        string? userId,
        string modelId,
        CancellationToken cancellationToken
    );

    // Read-only comparison of stored documents with the source rows.
    Task<SearchVerifyReport> VerifyAsync(
        string? userId,
        string modelId,
        CancellationToken cancellationToken
    );
}
