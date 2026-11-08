namespace Penny.Backend.Application.Abstractions.Persistence;

// Sessions are keyed by SHA-256(token); raw tokens are never stored.
public interface ISessionRepository
{
    // Also purges sessions that expired before `now`, as the legacy server does.
    Task CreateAsync(
        string tokenHash,
        string userId,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // A session is valid while expires_at > now.
    Task<string?> FindUserAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    Task RemoveAsync(string tokenHash, CancellationToken cancellationToken);
}
