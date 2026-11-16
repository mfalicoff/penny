using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// The owner-only receipt inbox (MAZ-184). Discard and Done delete only receipts that
// nothing references: the candidates are locked first (as receipt text does), so a
// concurrent save that links one either commits before and keeps it, or waits and then
// fails its foreign key check. Files are removed after the commit.
public sealed class PostgresReceiptInboxRepository(
    NpgsqlDataSource source,
    InboundMailSealer sealer,
    ReceiptFileStore receipts
) : IReceiptInboxRepository
{
    private static readonly string[] Unhandled =
    [
        ReceiptInboxStates.ToAttach,
        ReceiptInboxStates.PartlyAttached,
    ];

    public async Task<IReadOnlyList<StoredInboxItem>> ListAsync(
        string userId,
        bool attached,
        DateTimeOffset attachedSince,
        string? before,
        int limit,
        TimeSpan retention,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var items = context.ReceiptInboxItems.AsNoTracking().Where(item => item.UserId == userId);
        items = attached
            ? items.Where(item =>
                item.Status == ReceiptInboxStates.Attached && item.AttachedAt > attachedSince
            )
            : items.Where(item => Unhandled.Contains(item.Status));
        if (before is not null)
        {
            var cursor = await context
                .ReceiptInboxItems.AsNoTracking()
                .Where(item => item.UserId == userId && item.Id == before)
                .Select(item => new { item.ReceivedAt, item.Id })
                .SingleOrDefaultAsync(cancellationToken);
            if (cursor is null)
                return [];
            items = items.Where(item =>
                item.ReceivedAt < cursor.ReceivedAt
                || (item.ReceivedAt == cursor.ReceivedAt && string.Compare(item.Id, cursor.Id) < 0)
            );
        }
        var rows = await items
            .OrderByDescending(item => item.ReceivedAt)
            .ThenByDescending(item => item.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
        if (rows.Count == 0)
            return [];
        var ids = rows.Select(row => row.Id).ToList();
        var linked = ReceiptInboxStates.Linked(context);
        var linkedIds = await context
            .ReceiptInboxReceipts.Where(link => ids.Contains(link.InboxItemId))
            .Where(linked)
            .Select(link => link.ReceiptId)
            .ToListAsync(cancellationToken);
        var files = await context
            .ReceiptInboxReceipts.AsNoTracking()
            .Where(link => ids.Contains(link.InboxItemId))
            .Join(
                context.Receipts,
                link => link.ReceiptId,
                receipt => receipt.Id,
                (link, receipt) => new { link, receipt }
            )
            .OrderBy(row => row.link.Position)
            .ToListAsync(cancellationToken);
        var linkedSet = linkedIds.ToHashSet(StringComparer.Ordinal);
        return
        [
            .. rows.Select(row => new StoredInboxItem(
                row.Id,
                Open(row, row.FromNonce, row.FromEncrypted, "from"),
                Open(row, row.SubjectNonce, row.SubjectEncrypted, "subject"),
                row.ReceivedAt,
                row.Status,
                row.SenderVerified,
                row.Status == ReceiptInboxStates.Attached ? null : Deadline(row, retention),
                row.AttachedAt,
                [
                    .. files
                        .Where(file => file.link.InboxItemId == row.Id)
                        .Select(file => new StoredInboxFile(
                            file.receipt.Id,
                            file.link.Kind,
                            receipts.ReadName(file.receipt),
                            file.receipt.Mime,
                            file.receipt.SizeBytes,
                            linkedSet.Contains(file.receipt.Id)
                        )),
                ]
            )),
        ];
    }

    public Task<InboxCleanup?> DiscardAsync(
        string userId,
        string itemId,
        CancellationToken cancellationToken
    ) => CleanUpAsync(userId, itemId, null, cancellationToken);

    public Task<InboxCleanup?> DoneAsync(
        string userId,
        string itemId,
        DateTimeOffset now,
        CancellationToken cancellationToken
    ) => CleanUpAsync(userId, itemId, now, cancellationToken);

    public async Task<int> ExpireAsync(
        DateTimeOffset now,
        TimeSpan retention,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var returnedBefore = now - retention;
        var expired = await context
            .ReceiptInboxItems.AsNoTracking()
            .Where(item =>
                Unhandled.Contains(item.Status)
                && item.ExpiresAt <= now
                && (item.ReturnedAt == null || item.ReturnedAt <= returnedBefore)
            )
            .OrderBy(item => item.ExpiresAt)
            .Take(200)
            .Select(item => new { item.UserId, item.Id })
            .ToListAsync(cancellationToken);
        var count = 0;
        foreach (var item in expired)
            if (
                await CleanUpAsync(
                    item.UserId,
                    item.Id,
                    null,
                    cancellationToken,
                    onlyUnhandled: true
                )
                is not null
            )
                count++;
        return count;
    }

    // `doneAt` null discards the item (it is deleted); otherwise it becomes Attached.
    // A save that links one of these receipts at the same moment takes its locks in the
    // opposite order (the receipt's key lock, then the item), so PostgreSQL may abort one
    // side as a deadlock; the cleanup then starts over and sees the new link.
    private async Task<InboxCleanup?> CleanUpAsync(
        string userId,
        string itemId,
        DateTimeOffset? doneAt,
        CancellationToken cancellationToken,
        bool onlyUnhandled = false
    )
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await CleanUpOnceAsync(
                    userId,
                    itemId,
                    doneAt,
                    onlyUnhandled,
                    cancellationToken
                );
            }
            catch (Exception error) when (attempt < 3 && IsDeadlock(error)) { }
        }
    }

    private static bool IsDeadlock(Exception error) =>
        error is PostgresException { SqlState: PostgresErrorCodes.DeadlockDetected }
        || error.InnerException
            is PostgresException { SqlState: PostgresErrorCodes.DeadlockDetected };

    private async Task<InboxCleanup?> CleanUpOnceAsync(
        string userId,
        string itemId,
        DateTimeOffset? doneAt,
        bool onlyUnhandled,
        CancellationToken cancellationToken
    )
    {
        List<string> deletedPaths;
        int kept;
        await using (var context = PennyDbContext.Create(source))
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                cancellationToken
            );
            // The owner's ledger row first: every personal save takes it first too, so a
            // save linking one of these files either commits before (the file is kept) or
            // waits and then fails validation cleanly (the file is gone). Taking it before
            // the item also keeps the lock order the same as those saves.
            await context
                .Ledgers.Where(ledger => ledger.UserId == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(ledger => ledger.Revision, ledger => ledger.Revision),
                    cancellationToken
                );
            var items = context.ReceiptInboxItems.Where(item =>
                item.UserId == userId && item.Id == itemId
            );
            if (doneAt is not null || onlyUnhandled)
                items = items.Where(item => Unhandled.Contains(item.Status));
            // A no-op update locks the item, so two discards or a discard and a Done
            // serialize.
            if (
                await items.ExecuteUpdateAsync(
                    set => set.SetProperty(item => item.Status, item => item.Status),
                    cancellationToken
                ) != 1
            )
                return null;
            var receiptIds = await context
                .ReceiptInboxReceipts.Where(link => link.InboxItemId == itemId)
                .Select(link => link.ReceiptId)
                .ToListAsync(cancellationToken);
            await context
                .Receipts.Where(receipt => receiptIds.Contains(receipt.Id))
                .ExecuteUpdateAsync(
                    set => set.SetProperty(receipt => receipt.Mime, receipt => receipt.Mime),
                    cancellationToken
                );
            var unlinked = await context
                .Receipts.Where(receipt => receiptIds.Contains(receipt.Id))
                .Where(receipt =>
                    !context.LedgerEntries.Any(entry => entry.ReceiptId == receipt.Id)
                    && !context.HouseholdExpenses.Any(expense => expense.ReceiptId == receipt.Id)
                    && !context.HouseholdRecurring.Any(rule => rule.ReceiptId == receipt.Id)
                    && !context.SearchDocuments.Any(document => document.ReceiptId == receipt.Id)
                )
                .Select(receipt => new { receipt.Id, receipt.StoragePath })
                .ToListAsync(cancellationToken);
            var unlinkedIds = unlinked.Select(receipt => receipt.Id).ToList();
            kept = receiptIds.Count - unlinkedIds.Count;
            await context
                .ReceiptInboxReceipts.Where(link => unlinkedIds.Contains(link.ReceiptId))
                .ExecuteDeleteAsync(cancellationToken);
            // Chunks go with the text (ON DELETE CASCADE).
            await context
                .ReceiptTexts.Where(text => unlinkedIds.Contains(text.ReceiptId))
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .Receipts.Where(receipt => unlinkedIds.Contains(receipt.Id))
                .ExecuteDeleteAsync(cancellationToken);
            if (doneAt is { } now)
                await context
                    .ReceiptInboxItems.Where(item => item.Id == itemId)
                    .ExecuteUpdateAsync(
                        set =>
                            set.SetProperty(item => item.Status, ReceiptInboxStates.Attached)
                                .SetProperty(item => item.AttachedAt, now),
                        cancellationToken
                    );
            else
                // Links of kept receipts go with the item (ON DELETE CASCADE).
                await context
                    .ReceiptInboxItems.Where(item => item.Id == itemId)
                    .ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            deletedPaths = [.. unlinked.Select(receipt => receipt.StoragePath)];
        }
        foreach (var path in deletedPaths)
        {
            try
            {
                receipts.Delete(path);
            }
            catch (IOException)
            {
                // The row is gone; `receipts-sweep` removes an unreferenced file later.
            }
        }
        return new InboxCleanup(deletedPaths.Count, kept);
    }

    private static DateTimeOffset Deadline(ReceiptInboxItem item, TimeSpan retention) =>
        item.ReturnedAt is { } returned && returned + retention > item.ExpiresAt
            ? returned + retention
            : item.ExpiresAt;

    private string Open(ReceiptInboxItem item, byte[] nonce, byte[] sealedBytes, string part) =>
        sealer.OpenText(
            item.EncryptionVersion,
            item.KeySalt,
            nonce,
            sealedBytes,
            part,
            item.UserId,
            item.Id
        );
}
