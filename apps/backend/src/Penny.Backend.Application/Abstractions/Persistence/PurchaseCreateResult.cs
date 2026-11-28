namespace Penny.Backend.Application.Abstractions.Persistence;

// The item a capture made, or the one an earlier upload with the same key made
// (`Created` false). Null item: the owner's To review list is full.
public sealed record PurchaseCreateResult(StoredPurchase? Item, bool Created);
