using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresReceiptRepository(NpgsqlDataSource source, ReceiptFileStore files)
    : IReceiptRepository
{
    // Owner-scoped read; MAZ-60 adds shared-membership access and HTTP streaming.
    public async Task<StoredReceipt?> ReadAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await context
            .Receipts.AsNoTracking()
            .SingleOrDefaultAsync(
                receipt => receipt.UserId == userId && receipt.Id == receiptId,
                cancellationToken
            );
        return row is null
            ? null
            : new(
                row.Id,
                files.ReadName(row),
                row.Mime,
                await files.ReadContentAsync(row, cancellationToken)
            );
    }

    public async Task<IReadOnlyDictionary<string, StoredReceiptInfo>> DescribeAsync(
        string userId,
        IReadOnlyCollection<string> receiptIds,
        CancellationToken cancellationToken
    )
    {
        if (receiptIds.Count == 0)
            return new Dictionary<string, StoredReceiptInfo>(StringComparer.Ordinal);
        await using var context = PennyDbContext.Create(source);
        var rows = await context
            .Receipts.AsNoTracking()
            .Where(receipt => receipt.UserId == userId && receiptIds.Contains(receipt.Id))
            .ToListAsync(cancellationToken);
        // Filenames are encrypted at rest; only the name is opened, never the file.
        return rows.ToDictionary(
            row => row.Id,
            row => new StoredReceiptInfo(row.Id, files.ReadName(row), row.Mime),
            StringComparer.Ordinal
        );
    }
}
