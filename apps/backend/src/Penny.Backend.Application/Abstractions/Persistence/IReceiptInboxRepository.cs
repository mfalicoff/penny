namespace Penny.Backend.Application.Abstractions.Persistence;

// The owner-only receipt inbox (MAZ-184, docs/plans/email-receipts.md#4-the-receipt-inbox).
public interface IReceiptInboxRepository
{
    // Newest first. `attached` lists items attached since `attachedSince`; otherwise
    // To attach and Partly attached. `before` is the id of the last item of the
    // previous page.
    Task<IReadOnlyList<StoredInboxItem>> ListAsync(
        string userId,
        bool attached,
        DateTimeOffset attachedSince,
        string? before,
        int limit,
        TimeSpan retention,
        CancellationToken cancellationToken
    );

    // Deletes the item and its unlinked receipts. Null when the user has no such item.
    Task<InboxCleanup?> DiscardAsync(
        string userId,
        string itemId,
        CancellationToken cancellationToken
    );

    // Deletes the item's unlinked receipts and marks it Attached. Null when the user has
    // no such unhandled item.
    Task<InboxCleanup?> DoneAsync(
        string userId,
        string itemId,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Discards unhandled items whose deadline passed. Returns how many.
    Task<int> ExpireAsync(
        DateTimeOffset now,
        TimeSpan retention,
        CancellationToken cancellationToken
    );
}
