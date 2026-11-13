using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Persistence.Repositories;

// Receipt text storage and the extraction outbox (MAZ-125). Claims follow the search
// embedding outbox: candidates by the partial due index, then a conditional update that
// re-checks the lease after the row lock, so concurrent workers never share a row.
public sealed class PostgresReceiptTextRepository(NpgsqlDataSource source, ReceiptFileStore files)
    : IReceiptTextRepository
{
    private const int QueueBatch = 500;

    public async Task<IReadOnlyList<ReceiptTextWork>> ClaimAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        int maxAttempts,
        string engine,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<ReceiptText, bool>> due = text =>
            text.DueAt != null
            && text.DueAt <= now
            && (text.LeaseExpiresAt == null || text.LeaseExpiresAt <= now);
        await FailAbandonedAsync(context, due, now, maxAttempts, engine, cancellationToken);
        var candidates = await context
            .ReceiptTexts.AsNoTracking()
            .Where(due)
            .Where(text => text.Attempts < maxAttempts)
            .OrderBy(text => text.DueAt)
            .ThenBy(text => text.ReceiptId)
            .Take(limit)
            .Select(text => text.ReceiptId)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        // The attempt is counted when it starts, so one whose worker dies (an engine
        // that takes the process down, a host killed for memory) still uses one up.
        await context
            .ReceiptTexts.Where(text => candidates.Contains(text.ReceiptId))
            .Where(due)
            .Where(text => text.Attempts < maxAttempts)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(text => text.LeaseToken, leaseToken)
                        .SetProperty(text => text.LeaseExpiresAt, leaseUntil)
                        .SetProperty(text => text.Attempts, text => text.Attempts + 1),
                cancellationToken
            );
        var rows = await context
            .ReceiptTexts.AsNoTracking()
            .Where(text => candidates.Contains(text.ReceiptId) && text.LeaseToken == leaseToken)
            .Join(
                context.Receipts,
                text => text.ReceiptId,
                receipt => receipt.Id,
                (text, receipt) =>
                    new
                    {
                        text.ReceiptId,
                        receipt.Mime,
                        receipt.SizeBytes,
                        text.Attempts,
                        DueAt = text.DueAt!.Value,
                    }
            )
            .OrderBy(row => row.ReceiptId)
            .ToListAsync(cancellationToken);
        return
        [
            .. rows.Select(row => new ReceiptTextWork(
                row.ReceiptId,
                row.Mime,
                row.SizeBytes,
                row.Attempts,
                row.DueAt
            )),
        ];
    }

    // Due rows that already used every attempt: the last one was claimed and its lease
    // expired without a result, so the worker died during it. Running it again could
    // kill the next worker the same way; the receipt is failed instead (its text and
    // chunks cleared, as for any failed result).
    private static async Task FailAbandonedAsync(
        PennyDbContext context,
        Expression<Func<ReceiptText, bool>> due,
        DateTimeOffset now,
        int maxAttempts,
        string engine,
        CancellationToken cancellationToken
    )
    {
        var abandoned = await context
            .ReceiptTexts.AsNoTracking()
            .Where(due)
            .Where(text => text.Attempts >= maxAttempts)
            .Select(text => text.ReceiptId)
            .Take(QueueBatch)
            .ToListAsync(cancellationToken);
        if (abandoned.Count == 0)
            return;
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var failed = await context
            .ReceiptTexts.Where(text => abandoned.Contains(text.ReceiptId))
            .Where(due)
            .Where(text => text.Attempts >= maxAttempts)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(text => text.Status, ReceiptTextStatus.Failed)
                        .SetProperty(text => text.Failure, ReceiptTextFailure.LeaseExpired)
                        .SetProperty(text => text.Method, (string?)null)
                        .SetProperty(text => text.Engine, engine)
                        .SetProperty(text => text.Content, "")
                        .SetProperty(text => text.SearchText, "")
                        .SetProperty(text => text.Pages, (int?)null)
                        .SetProperty(text => text.ExtractedAt, now)
                        .SetProperty(text => text.DueAt, (DateTimeOffset?)null)
                        .SetProperty(text => text.LeaseToken, (string?)null)
                        .SetProperty(text => text.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
        if (failed > 0)
            await context
                .ReceiptTextChunks.Where(chunk =>
                    abandoned.Contains(chunk.ReceiptId)
                    && context.ReceiptTexts.Any(text =>
                        text.ReceiptId == chunk.ReceiptId && text.Status == ReceiptTextStatus.Failed
                    )
                )
                .ExecuteDeleteAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<byte[]> ReadContentAsync(
        string receiptId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await context
            .Receipts.AsNoTracking()
            .SingleAsync(receipt => receipt.Id == receiptId, cancellationToken);
        // Decrypted into memory only; the caller zeroes the buffer when done.
        return await files.ReadContentAsync(row, cancellationToken);
    }

    public async Task<bool> CompleteAsync(
        string leaseToken,
        ReceiptTextResult result,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var updated = await context
            .ReceiptTexts.Where(text =>
                text.ReceiptId == result.ReceiptId && text.LeaseToken == leaseToken
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(text => text.Status, result.Status)
                        .SetProperty(text => text.Method, result.Method)
                        .SetProperty(text => text.Engine, result.Engine)
                        .SetProperty(text => text.Content, result.Content)
                        .SetProperty(text => text.SearchText, result.SearchText)
                        .SetProperty(text => text.Pages, result.Pages)
                        .SetProperty(text => text.Failure, result.Failure)
                        .SetProperty(text => text.Attempts, result.Attempts)
                        .SetProperty(text => text.ExtractedAt, result.ExtractedAt)
                        .SetProperty(text => text.DueAt, (DateTimeOffset?)null)
                        .SetProperty(text => text.LeaseToken, (string?)null)
                        .SetProperty(text => text.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
        // The lease was lost, or the receipt was unlinked and its text deleted.
        if (updated != 1)
            return false;
        // Chunks whose passage is unchanged keep their embedding (a re-run by another
        // engine version usually reads the same text); only changed ones are replaced
        // and queued for embedding.
        var stored = await context
            .ReceiptTextChunks.AsNoTracking()
            .Where(chunk => chunk.ReceiptId == result.ReceiptId)
            .Select(chunk => new { chunk.Ordinal, chunk.Passage })
            .ToListAsync(cancellationToken);
        var kept = stored
            .Where(chunk =>
                chunk.Ordinal < result.Chunks.Count
                && string.Equals(
                    chunk.Passage,
                    result.Chunks[chunk.Ordinal],
                    StringComparison.Ordinal
                )
            )
            .Select(chunk => chunk.Ordinal)
            .ToHashSet();
        if (kept.Count < stored.Count)
            await context
                .ReceiptTextChunks.Where(chunk =>
                    chunk.ReceiptId == result.ReceiptId && !kept.Contains(chunk.Ordinal)
                )
                .ExecuteDeleteAsync(cancellationToken);
        context.ReceiptTextChunks.AddRange(
            ReceiptTextIndex
                .Chunks(result.ReceiptId, result.Chunks)
                .Where(chunk => !kept.Contains(chunk.Ordinal))
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task RetryAsync(
        string leaseToken,
        string receiptId,
        DateTimeOffset retryAt,
        string failure,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .ReceiptTexts.Where(text =>
                text.ReceiptId == receiptId && text.LeaseToken == leaseToken
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(text => text.DueAt, retryAt)
                        .SetProperty(text => text.Failure, failure)
                        .SetProperty(text => text.LeaseToken, (string?)null)
                        .SetProperty(text => text.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
    }

    public async Task<ReceiptTextQueueReport> QueueAsync(
        string? userId,
        bool all,
        string engine,
        CancellationToken cancellationToken
    )
    {
        long created = 0;
        while (true)
        {
            await using var context = PennyDbContext.Create(source);
            await using var transaction = await context.Database.BeginTransactionAsync(
                cancellationToken
            );
            var batch = await Unextracted(context, Receipts(context, userId))
                .OrderBy(receipt => receipt.Id)
                .Take(QueueBatch)
                .Select(receipt => receipt.Id)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
                break;
            // The receipt row locks order this with writers linking the same receipts.
            await context
                .Receipts.Where(receipt => batch.Contains(receipt.Id))
                .ExecuteUpdateAsync(
                    set => set.SetProperty(receipt => receipt.Mime, receipt => receipt.Mime),
                    cancellationToken
                );
            // Re-checked under the locks: a writer may have unlinked one meanwhile.
            var missing = await Unextracted(
                    context,
                    context.Receipts.Where(receipt => batch.Contains(receipt.Id))
                )
                .Select(receipt => receipt.Id)
                .ToListAsync(cancellationToken);
            context.ReceiptTexts.AddRange(missing.Select(ReceiptTextIndex.Pending));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            created += missing.Count;
        }
        await using (var context = PennyDbContext.Create(source))
        {
            var receiptIds = Receipts(context, userId).Select(receipt => receipt.Id);
            // Leased rows are being extracted now; they are left alone.
            var requeued = await context
                .ReceiptTexts.Where(text =>
                    receiptIds.Contains(text.ReceiptId)
                    && text.Status != ReceiptTextStatus.Pending
                    && text.LeaseToken == null
                    && (all || text.Status == ReceiptTextStatus.Failed || text.Engine != engine)
                )
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(text => text.Status, ReceiptTextStatus.Pending)
                            .SetProperty(text => text.DueAt, SearchIndexer.DueNow)
                            .SetProperty(text => text.Attempts, 0)
                            .SetProperty(text => text.Failure, (string?)null),
                    cancellationToken
                );
            return new(created, requeued);
        }
    }

    public async Task<ReceiptTextStatusReport> StatusAsync(
        string? userId,
        string engine,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var receipts = Receipts(context, userId);
        var receiptIds = receipts.Select(receipt => receipt.Id);
        var texts = context.ReceiptTexts.Where(text => receiptIds.Contains(text.ReceiptId));
        var counts = await texts
            .GroupBy(text => text.Status)
            .Select(group => new { Status = group.Key, Count = group.LongCount() })
            .ToDictionaryAsync(row => row.Status, row => row.Count, cancellationToken);
        return new(
            await receipts.LongCountAsync(cancellationToken),
            await Unextracted(context, receipts).LongCountAsync(cancellationToken),
            counts.GetValueOrDefault(ReceiptTextStatus.Pending),
            counts.GetValueOrDefault(ReceiptTextStatus.Done),
            counts.GetValueOrDefault(ReceiptTextStatus.Failed),
            counts.GetValueOrDefault(ReceiptTextStatus.Unsupported),
            await texts.LongCountAsync(
                text => text.Status != ReceiptTextStatus.Pending && text.Engine != engine,
                cancellationToken
            )
        );
    }

    // Receipts that are linked now (by a search document, i.e. an entry or live shared
    // expense, or by a shared rule) and have no text row. An unlinked receipt without
    // one had its text deleted when its last link let go (or was never linked after an
    // upload before MAZ-125); the backfill must not bring that text back. Linking it
    // again queues it (ReceiptTextIndex).
    private static IQueryable<Receipt> Unextracted(
        PennyDbContext context,
        IQueryable<Receipt> receipts
    ) =>
        receipts.Where(receipt =>
            !context.ReceiptTexts.Any(text => text.ReceiptId == receipt.Id)
            && (
                context.SearchDocuments.Any(document => document.ReceiptId == receipt.Id)
                || context.HouseholdRecurring.Any(rule => rule.ReceiptId == receipt.Id)
            )
        );

    private static IQueryable<Receipt> Receipts(PennyDbContext context, string? userId) =>
        userId is null
            ? context.Receipts
            : context.Receipts.Where(receipt => receipt.UserId == userId);
}
