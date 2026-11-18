using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Receipts;

// Receipts nothing links to (MAZ-165): no personal entry, shared expense (a deleted one
// keeps its link), shared rule, search document or inbox email. Uploads happen before
// Save, so discarded drafts, removed or replaced receipts and cancelled forms leave
// them. Only receipts older than the caller's cutoff are touched, so a draft or an
// offline save that links one later still finds it.
internal static class UnlinkedReceipts
{
    private const int BatchSize = 200;
    private const string ForeignKeyViolation = "23503";

    // Deletes (or, in a dry run, counts) unlinked receipts created before
    // `createdBefore`: text, row, then file. Returns how many.
    public static async Task<long> RemoveAsync(
        NpgsqlDataSource source,
        ReceiptFileStore files,
        DateTimeOffset createdBefore,
        bool dryRun,
        CancellationToken cancellationToken
    )
    {
        long removed = 0;
        string? after = null;
        while (true)
        {
            List<(string Id, string UserId)> batch;
            await using (var context = PennyDbContext.Create(source))
            {
                var candidates = Unlinked(context, context.Receipts.AsNoTracking())
                    .Where(receipt => receipt.CreatedAt < createdBefore);
                if (after is not null)
                    candidates = candidates.Where(receipt => string.Compare(receipt.Id, after) > 0);
                batch =
                [
                    .. (
                        await candidates
                            .OrderBy(receipt => receipt.Id)
                            .Take(BatchSize)
                            .Select(receipt => new { receipt.Id, receipt.UserId })
                            .ToListAsync(cancellationToken)
                    ).Select(receipt => (receipt.Id, receipt.UserId)),
                ];
            }
            if (batch.Count == 0)
                return removed;
            after = batch[^1].Id;
            if (dryRun)
            {
                removed += batch.Count;
                continue;
            }
            foreach (var owner in batch.GroupBy(receipt => receipt.UserId, StringComparer.Ordinal))
                removed += await RemoveOwnedAsync(
                    source,
                    files,
                    owner.Key,
                    [.. owner.Select(receipt => receipt.Id)],
                    createdBefore,
                    cancellationToken
                );
        }
    }

    // One owner's candidates in one transaction. The owner's ledger row is locked
    // first, as every personal save does, so a save linking one of them either commits
    // first (the receipt is kept) or waits and then fails validation cleanly. The
    // receipts are locked and checked again inside the transaction; a shared save that
    // links one concurrently makes the delete fail its foreign key, and the batch is
    // left for the next pass.
    private static async Task<long> RemoveOwnedAsync(
        NpgsqlDataSource source,
        ReceiptFileStore files,
        string userId,
        List<string> receiptIds,
        DateTimeOffset createdBefore,
        CancellationToken cancellationToken
    )
    {
        List<string> deletedPaths;
        try
        {
            await using var context = PennyDbContext.Create(source);
            await using var transaction = await context.Database.BeginTransactionAsync(
                cancellationToken
            );
            await context
                .Ledgers.Where(ledger => ledger.UserId == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(ledger => ledger.Revision, ledger => ledger.Revision),
                    cancellationToken
                );
            var owned = context.Receipts.Where(receipt =>
                receipt.UserId == userId && receiptIds.Contains(receipt.Id)
            );
            // A no-op update locks the rows, so two passes don't delete the same file.
            await owned.ExecuteUpdateAsync(
                set => set.SetProperty(receipt => receipt.Mime, receipt => receipt.Mime),
                cancellationToken
            );
            var unlinked = await Unlinked(context, owned)
                .Where(receipt => receipt.CreatedAt < createdBefore)
                .Select(receipt => new { receipt.Id, receipt.StoragePath })
                .ToListAsync(cancellationToken);
            var unlinkedIds = unlinked.Select(receipt => receipt.Id).ToList();
            if (unlinkedIds.Count == 0)
                return 0;
            // Chunks go with the text (ON DELETE CASCADE).
            await context
                .ReceiptTexts.Where(text => unlinkedIds.Contains(text.ReceiptId))
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .Receipts.Where(receipt => unlinkedIds.Contains(receipt.Id))
                .ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            deletedPaths = [.. unlinked.Select(receipt => receipt.StoragePath)];
        }
        catch (Exception error)
            when (error
                    is PostgresException { SqlState: ForeignKeyViolation }
                        or DbUpdateException
                        {
                            InnerException: PostgresException { SqlState: ForeignKeyViolation },
                        }
            )
        {
            return 0;
        }
        foreach (var path in deletedPaths)
        {
            try
            {
                files.Delete(path);
            }
            catch (IOException)
            {
                // The row is gone; `receipts-sweep` removes an unreferenced file later.
            }
        }
        return deletedPaths.Count;
    }

    private static IQueryable<Receipt> Unlinked(
        PennyDbContext context,
        IQueryable<Receipt> receipts
    ) =>
        receipts.Where(receipt =>
            !context.LedgerEntries.Any(entry =>
                entry.UserId == receipt.UserId && entry.ReceiptId == receipt.Id
            )
            && !context.HouseholdExpenses.Any(expense => expense.ReceiptId == receipt.Id)
            && !context.HouseholdRecurring.Any(rule => rule.ReceiptId == receipt.Id)
            && !context.SearchDocuments.Any(document => document.ReceiptId == receipt.Id)
            && !context.ReceiptInboxReceipts.Any(link => link.ReceiptId == receipt.Id)
        );
}
