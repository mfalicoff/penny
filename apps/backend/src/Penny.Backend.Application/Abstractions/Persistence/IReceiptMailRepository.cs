using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Application.Abstractions.Persistence;

// Receipt addresses and the raw inbound queue (MAZ-184).
public interface IReceiptMailRepository
{
    // The user's live address (not revoked, not expired at `now`), or null.
    Task<StoredMailAddress?> ReadCurrentAsync(
        string userId,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Addresses created by the user since `since` (revoked ones included).
    Task<int> CountCreatedSinceAsync(
        string userId,
        DateTimeOffset since,
        CancellationToken cancellationToken
    );

    // Revokes the user's current address (if any) and stores a new one in one
    // transaction. The allowed senders carry over from the replaced address.
    Task<StoredMailAddress> ReplaceAsync(
        string userId,
        string address,
        string localPartHash,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken
    );

    // Changes the live address; null when there is none.
    Task<StoredMailAddress?> UpdateAsync(
        string userId,
        DateTimeOffset now,
        DateTimeOffset? expiresAt,
        IReadOnlyList<string>? allowedSenders,
        CancellationToken cancellationToken
    );

    Task RevokeAsync(string userId, DateTimeOffset now, CancellationToken cancellationToken);

    // SHA-256 hex of every live local part, sorted.
    Task<IReadOnlyList<string>> LiveHashesAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    Task<InboundAcceptOutcome> AcceptAsync(
        InboundDelivery delivery,
        InboundMailSettings limits,
        CancellationToken cancellationToken
    );
}
