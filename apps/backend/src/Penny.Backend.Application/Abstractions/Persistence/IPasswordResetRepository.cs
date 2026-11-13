namespace Penny.Backend.Application.Abstractions.Persistence;

// Operator-issued password reset codes, keyed by SHA-256(code); raw codes are never
// stored. A user has at most one pending code.
public interface IPasswordResetRepository
{
    // In one transaction: purges codes that expired at or before `now`, deletes the
    // user's earlier code (superseded) and stores the new one. A concurrent issue for
    // the same user fails on the one-code-per-user index instead of leaving two codes.
    Task ReplaceAsync(
        string userId,
        string tokenHash,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Atomically consumes the code. If it was unexpired (expires_at > now), the same
    // transaction stores `passwordHash` and deletes every
    // session of the user, so their push devices cascade. False for unknown, used,
    // superseded and expired codes; an expired code is deleted. Concurrent callers for
    // the same hash get true at most once.
    Task<bool> TryRedeemAsync(
        string tokenHash,
        string passwordHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );
}
