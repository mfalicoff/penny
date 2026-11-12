namespace Penny.Backend.Application.Abstractions.Persistence;

// Receipt text extraction storage (MAZ-125). `receipt_texts` holds one row per receipt
// and is also the extraction outbox: pending rows are claimed with an expiring lease
// and retried with backoff, so any number of workers can run.
public interface IReceiptTextRepository
{
    // Leases up to `limit` due rows to `leaseToken` until `leaseUntil` and counts the
    // attempt (`attempts + 1`) in the same update. Rows leased to another live worker
    // are skipped. Due rows that already used `maxAttempts` (their last attempt's lease
    // expired without a result: the worker died) are failed as `lease-expired` with
    // `engine` instead of being run again.
    Task<IReadOnlyList<ReceiptTextWork>> ClaimAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        int maxAttempts,
        string engine,
        CancellationToken cancellationToken
    );

    // The decrypted receipt bytes, in memory only. Throws when the file is missing or
    // fails authentication.
    Task<byte[]> ReadContentAsync(string receiptId, CancellationToken cancellationToken);

    // Stores the result and replaces the receipt's chunks (queued for embedding) in one
    // transaction, if the row is still leased to `leaseToken`. False when the lease was
    // lost or the receipt was unlinked (its text deleted) meanwhile.
    Task<bool> CompleteAsync(
        string leaseToken,
        ReceiptTextResult result,
        CancellationToken cancellationToken
    );

    // Gives up the lease after a failed attempt (already counted by the claim): the row
    // stays pending and is retried at `retryAt`.
    Task RetryAsync(
        string leaseToken,
        string receiptId,
        DateTimeOffset retryAt,
        string failure,
        CancellationToken cancellationToken
    );

    // Backfill: creates pending rows for linked receipts (by an entry, a live shared
    // expense or a shared rule) without one, and queues failed rows and rows made by
    // another engine (every finished row with `all`), for every receipt or the receipts
    // `userId` uploaded. Unlinked receipts without a row stay without: their text was
    // deleted when the last link let go.
    Task<ReceiptTextQueueReport> QueueAsync(
        string? userId,
        bool all,
        string engine,
        CancellationToken cancellationToken
    );

    Task<ReceiptTextStatusReport> StatusAsync(
        string? userId,
        string engine,
        CancellationToken cancellationToken
    );
}
