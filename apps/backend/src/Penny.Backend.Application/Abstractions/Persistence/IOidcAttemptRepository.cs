namespace Penny.Backend.Application.Abstractions.Persistence;

// Pending OIDC sign-ins live in PostgreSQL so they survive restarts and work across
// API instances. Each attempt can be consumed once.
public interface IOidcAttemptRepository
{
    // Purges attempts that expired at or before `now`, then stores the attempt unless
    // `limit` attempts are already pending. False means the limit was reached.
    Task<bool> TryCreateAsync(
        StoredOidcAttempt attempt,
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken
    );

    // Atomically deletes and returns the attempt. Concurrent callers for the same hash
    // get it at most once; everyone else gets null. Expiry is checked by the caller.
    Task<StoredOidcAttempt?> ConsumeAsync(
        string transactionHash,
        CancellationToken cancellationToken
    );

    Task RemoveAsync(string transactionHash, CancellationToken cancellationToken);
}
