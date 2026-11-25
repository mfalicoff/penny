using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.InboundMail;

// The receipt inbox (MAZ-184): list, discard and Done. Items are private to their owner;
// another user's item is "not found". Attaching uses the normal entry and shared expense
// saves with `receiptId`; their transactions keep the item states in step.
public sealed class ReceiptInboxService(
    IReceiptInboxRepository inbox,
    InboundMailSettings settings,
    TimeProvider clock
)
{
    public const int PageSize = 50;
    public const string NotFound = "Inbox item not found.";
    public const string InvalidFilter = "status must be to_attach or attached.";
    public static readonly TimeSpan AttachedListWindow = TimeSpan.FromDays(30);

    public async Task<(IReadOnlyList<StoredInboxItem> Items, string? Next)> ListAsync(
        string userId,
        string? status,
        string? before,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        var attached = status switch
        {
            null or "" or "to_attach" => false,
            "attached" => true,
            _ => throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptInboxInvalidFilter,
                InvalidFilter
            ),
        };
        if (before is not null && !IsId(before))
            return ([], null);
        var items = await inbox.ListAsync(
            userId,
            attached,
            clock.GetUtcNow() - AttachedListWindow,
            before,
            PageSize + 1,
            TimeSpan.FromDays(settings.InboxRetentionDays),
            cancellationToken
        );
        return items.Count > PageSize
            ? ([.. items.Take(PageSize)], items[PageSize - 1].Id)
            : (items, null);
    }

    public async Task<InboxCleanup> DiscardAsync(
        string userId,
        string itemId,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        return (IsId(itemId) ? await inbox.DiscardAsync(userId, itemId, cancellationToken) : null)
            ?? throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.ReceiptInboxNotFound,
                NotFound
            );
    }

    public async Task<InboxCleanup> DoneAsync(
        string userId,
        string itemId,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        return (
            IsId(itemId)
                ? await inbox.DoneAsync(userId, itemId, clock.GetUtcNow(), cancellationToken)
                : null
        )
            ?? throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.ReceiptInboxNotFound,
                NotFound
            );
    }

    private void RequireEnabled()
    {
        if (!settings.Enabled)
            throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.ReceiptEmailNotEnabled,
                ReceiptEmailService.NotEnabled
            );
    }

    private static bool IsId(string value) =>
        value.Length == 32
        && value.All(character => char.IsAsciiDigit(character) || character is >= 'a' and <= 'f')
        && LedgerText.IsStorable(value);
}
