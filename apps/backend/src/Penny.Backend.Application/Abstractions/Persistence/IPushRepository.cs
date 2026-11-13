using Penny.Backend.Application.Push;

namespace Penny.Backend.Application.Abstractions.Persistence;

// Session-scoped push devices and the durable delivery outbox (MAZ-61). Outbox rows
// are written by the financial writers in their own transactions; this repository
// leases them to delivery runners. Every lease names a random token, so a runner
// that lost its lease (expiry, crash, takeover) changes nothing it no longer owns.
public interface IPushRepository
{
    // Upserts the token for this session. Pending deliveries of another user's
    // messages to the same token finish first, so a transferred device never
    // receives the previous owner's notifications.
    Task RegisterAsync(
        string userId,
        string sessionHash,
        PushDeviceRegistration device,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Removes the token only when this user's session registered it; its pending
    // deliveries then finish undelivered.
    Task RemoveAsync(
        string userId,
        string sessionHash,
        string token,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Leases up to `limit` due, unleased outbox messages to `leaseToken`.
    Task<IReadOnlyList<PushClaim>> ClaimAsync(
        string leaseOwner,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    );

    // In one transaction under the message's lease: expires a message created before
    // `expiredBefore`, plans its deliveries on first use (the recipient's devices with
    // live sessions), finishes deliveries whose device left the recipient or whose
    // session ended, and takes up to `limit` due deliveries (counting the attempt).
    // Returns null when the lease was lost. With nothing to send it also settles the
    // message and releases the lease.
    Task<IReadOnlyList<PushDispatch>?> PrepareAsync(
        string outboxId,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        DateTimeOffset expiredBefore,
        int limit,
        CancellationToken cancellationToken
    );

    // Applies provider outcomes, cleans up invalid tokens registered before
    // `claimedAt`, settles the message and releases the lease.
    Task RecordAsync(
        string outboxId,
        string leaseToken,
        IReadOnlyList<PushDeliveryResult> results,
        DateTimeOffset now,
        DateTimeOffset claimedAt,
        CancellationToken cancellationToken
    );
}
