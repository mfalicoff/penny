namespace Penny.Backend.Application.Abstractions.Persistence;

// Captured purchases in the owner-only Inbox (MAZ-291), beside emailed receipts.
public interface IPurchaseInboxRepository
{
    // Stores the capture once per (user, idempotency key). Done items resolved before
    // `doneBefore` are deleted on the way. Refuses (null item) once `maxToReview` wait.
    Task<PurchaseCreateResult> CreateAsync(
        string userId,
        PurchaseCapture capture,
        DateTimeOffset now,
        DateTimeOffset doneBefore,
        int maxToReview,
        CancellationToken cancellationToken
    );

    // Newest capture first. `done` lists items resolved since `doneSince`; otherwise To
    // review. `before` is the id of the last item of the previous page.
    Task<IReadOnlyList<StoredPurchase>> ListAsync(
        string userId,
        bool done,
        DateTimeOffset doneSince,
        string? before,
        int limit,
        CancellationToken cancellationToken
    );

    Task<StoredPurchase?> FindAsync(string userId, string id, CancellationToken cancellationToken);

    // Moves a To review item to done. Returns the item as stored afterwards (unchanged
    // when it was already done), or null when the user has no such item.
    Task<StoredPurchase?> ResolveAsync(
        string userId,
        string id,
        PurchaseResolution resolution,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Moves a done item back to To review (Undo). Null when the user has no such item.
    Task<StoredPurchase?> ReopenAsync(
        string userId,
        string id,
        CancellationToken cancellationToken
    );

    Task<IReadOnlyList<StoredCardAccount>> CardsAsync(
        string userId,
        CancellationToken cancellationToken
    );

    // Replaces the whole card mapping.
    Task ReplaceCardsAsync(
        string userId,
        IReadOnlyList<StoredCardAccount> cards,
        CancellationToken cancellationToken
    );
}
