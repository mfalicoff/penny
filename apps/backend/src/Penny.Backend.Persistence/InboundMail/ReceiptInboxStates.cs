using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.InboundMail;

// Keeps receipt inbox states in step with receipt links (MAZ-184,
// docs/plans/email-receipts.md#inbox-states). Called in the same transaction as every
// write that links or releases receipts (personal ledger saves, shared expenses and
// rules, search rebuilds; see ReceiptTextIndex.ApplyAsync). A receipt is linked while
// a personal entry, a live shared expense or a shared rule references it.
// - Every file linked: Attached (attached_at set the first time).
// - Some: Partly attached. None: To attach.
// - An item that falls back to To attach records returned_at, which restarts its expiry.
// Times are the database clock; discarded items never change.
internal static class ReceiptInboxStates
{
    public const string ToAttach = "to_attach";
    public const string PartlyAttached = "partly_attached";
    public const string Attached = "attached";

    public static Expression<Func<ReceiptInboxReceipt, bool>> Linked(PennyDbContext context) =>
        link =>
            context.LedgerEntries.Any(entry => entry.ReceiptId == link.ReceiptId)
            || context.HouseholdExpenses.Any(expense =>
                expense.ReceiptId == link.ReceiptId && expense.DeletedAt == null
            )
            || context.HouseholdRecurring.Any(rule => rule.ReceiptId == link.ReceiptId);

    public static async Task RefreshAsync(
        PennyDbContext context,
        IReadOnlyCollection<string> receiptIds,
        CancellationToken cancellationToken
    )
    {
        if (receiptIds.Count == 0)
            return;
        var itemIds = await context
            .ReceiptInboxReceipts.Where(link => receiptIds.Contains(link.ReceiptId))
            .Select(link => link.InboxItemId)
            .Distinct()
            .ToListAsync(cancellationToken);
        if (itemIds.Count == 0)
            return;
        var linked = Linked(context);
        var counts = await context
            .ReceiptInboxReceipts.Where(link => itemIds.Contains(link.InboxItemId))
            .GroupBy(link => link.InboxItemId)
            .Select(group => new { Id = group.Key, Total = group.Count() })
            .ToListAsync(cancellationToken);
        var linkedCounts = await context
            .ReceiptInboxReceipts.Where(link => itemIds.Contains(link.InboxItemId))
            .Where(linked)
            .GroupBy(link => link.InboxItemId)
            .Select(group => new { Id = group.Key, Linked = group.Count() })
            .ToDictionaryAsync(row => row.Id, row => row.Linked, cancellationToken);
        foreach (var item in counts)
        {
            var linkedCount = linkedCounts.GetValueOrDefault(item.Id);
            var status =
                linkedCount == 0 ? ToAttach
                : linkedCount == item.Total ? Attached
                : PartlyAttached;
            var rows = context.ReceiptInboxItems.Where(row =>
                row.Id == item.Id && row.Status != "discarded" && row.Status != status
            );
            if (status == Attached)
                await rows.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.Status, status)
                            .SetProperty(
                                row => row.AttachedAt,
                                row => row.AttachedAt ?? DateTimeOffset.UtcNow
                            ),
                    cancellationToken
                );
            else if (status == ToAttach)
                await rows.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.Status, status)
                            .SetProperty(row => row.AttachedAt, (DateTimeOffset?)null)
                            .SetProperty(row => row.ReturnedAt, DateTimeOffset.UtcNow),
                    cancellationToken
                );
            else
                await rows.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.Status, status)
                            .SetProperty(row => row.AttachedAt, (DateTimeOffset?)null),
                    cancellationToken
                );
        }
    }
}
