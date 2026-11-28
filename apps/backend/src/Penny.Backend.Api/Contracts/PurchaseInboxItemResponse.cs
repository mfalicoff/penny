using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Api.Contracts;

// Contract schema `PurchaseInboxItem` (2.5.0, MAZ-291). `merchant` and `card` are plain
// text to display as text only. `amount` is in minor units of `currency`. Times are Unix
// milliseconds. `outcome`, `entryId`, `householdId` and `resolvedAt` are null until done.
public sealed record PurchaseInboxItemResponse(
    string Id,
    string Merchant,
    long Amount,
    string Currency,
    string? Card,
    long CapturedAt,
    long CreatedAt,
    string Status,
    string? Outcome,
    string? EntryId,
    string? HouseholdId,
    long? ResolvedAt
)
{
    public static PurchaseInboxItemResponse Of(StoredPurchase item) =>
        new(
            item.Id,
            item.Merchant,
            item.Amount,
            item.Currency,
            item.Card,
            item.CapturedAt.ToUnixTimeMilliseconds(),
            item.CreatedAt.ToUnixTimeMilliseconds(),
            item.Status,
            item.Outcome,
            item.EntryId,
            item.HouseholdId,
            item.ResolvedAt?.ToUnixTimeMilliseconds()
        );
}
