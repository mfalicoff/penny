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
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<ReceiptText, bool>> due = text =>
            text.DueAt != null
            && text.DueAt <= now
            && (text.LeaseExpiresAt == null || text.LeaseExpiresAt <= now);
        var candidates = await context
            .ReceiptTexts.AsNoTracking()
            .Where(due)
            .OrderBy(text => text.DueAt)
            .ThenBy(text => text.ReceiptId)
            .Take(limit)
            .Select(text => text.ReceiptId)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await context
            .ReceiptTexts.Where(text => candidates.Contains(text.ReceiptId))
            .Where(due)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(text => text.LeaseToken, leaseToken)
                        .SetProperty(text => text.LeaseExpiresAt, leaseUntil),
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
        await context
            .ReceiptTextChunks.Where(chunk => chunk.ReceiptId == result.ReceiptId)
            .ExecuteDeleteAsync(cancellationToken);
        context.ReceiptTextChunks.AddRange(
            ReceiptTextIndex.Chunks(result.ReceiptId, result.Chunks)
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
                        .SetProperty(text => text.Attempts, text => text.Attempts + 1)
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
            var batch = await Receipts(context, userId)
                .Where(receipt => !context.ReceiptTexts.Any(text => text.ReceiptId == receipt.Id))
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
            var existing = await context
                .ReceiptTexts.Where(text => batch.Contains(text.ReceiptId))
                .Select(text => text.ReceiptId)
                .ToListAsync(cancellationToken);
            var missing = batch.Except(existing, StringComparer.Ordinal).ToList();
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
            await receipts.LongCountAsync(
                receipt => !context.ReceiptTexts.Any(text => text.ReceiptId == receipt.Id),
                cancellationToken
            ),
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

    private static IQueryable<Receipt> Receipts(PennyDbContext context, string? userId) =>
        userId is null
            ? context.Receipts
            : context.Receipts.Where(receipt => receipt.UserId == userId);
}
