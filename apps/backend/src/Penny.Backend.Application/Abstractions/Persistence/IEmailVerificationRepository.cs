namespace Penny.Backend.Application.Abstractions.Persistence;

// Emailed email-verification codes (MAZ-172), keyed by SHA-256(code); raw codes are never
// stored. A user has at most one pending code, bound to the address it was sent to.
public interface IEmailVerificationRepository
{
    // In one transaction: purges codes that expired at or before `now`, deletes the user's
    // earlier code (superseded) and stores the new one for `email`.
    Task ReplaceAsync(
        string userId,
        string email,
        string tokenHash,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Atomically consumes the code. If it was unexpired (expires_at > now) and the account
    // still has the address the code was sent to, the same transaction records the email as
    // verified at `now` (keeping an earlier verification time) and returns the address.
    // Null for unknown, used, superseded, expired and changed-address codes; each of those
    // that still exists is deleted. Concurrent callers for one hash get an address at most once.
    Task<string?> TryRedeemAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );
}
