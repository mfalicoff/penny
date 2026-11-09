using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresReceiptRepository(NpgsqlDataSource source, ReceiptFileStore files)
    : IReceiptRepository
{
    public async Task<StoredReceipt?> ReadAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await OpenAsync(
            await context
                .Receipts.AsNoTracking()
                .SingleOrDefaultAsync(
                    receipt => receipt.UserId == userId && receipt.Id == receiptId,
                    cancellationToken
                ),
            cancellationToken
        );
    }

    // One statement decides access, so a membership change that commits before the
    // read is always honoured.
    public async Task<StoredReceipt?> ReadVisibleAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await context
            .Receipts.AsNoTracking()
            .Where(receipt =>
                receipt.Id == receiptId
                && (
                    receipt.UserId == userId
                    || context.HouseholdExpenses.Any(expense =>
                        expense.ReceiptId == receipt.Id
                        && expense.DeletedAt == null
                        && (
                            context.HouseholdMemberPeriods.Any(period =>
                                period.HouseholdId == expense.HouseholdId
                                && period.UserId == userId
                                && period.LeftAt == null
                            )
                            || (
                                context.HouseholdSplits.Any(share =>
                                    share.ExpenseId == expense.Id && share.UserId == userId
                                )
                                && context.HouseholdMemberPeriods.Any(period =>
                                    period.HouseholdId == expense.HouseholdId
                                    && period.UserId == userId
                                )
                            )
                        )
                    )
                )
            )
            .SingleOrDefaultAsync(cancellationToken);
        return await OpenAsync(row, cancellationToken);
    }

    // File first (temp, fsync, no-overwrite rename), then the row, so a row never
    // lacks its file. The file is removed only when PostgreSQL definitely rejected the
    // insert; after an ambiguous failure (connection lost, possibly after commit) it
    // stays, and `receipts-sweep` removes it later if no row references it.
    public async Task CreateAsync(
        string userId,
        StoredReceipt receipt,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken
    )
    {
        var encrypted = files.Encrypt(
            userId,
            receipt.Id,
            receipt.Name,
            receipt.Mime,
            receipt.Data,
            createdAt
        );
        await files.WriteAsync(encrypted, cancellationToken);
        try
        {
            await using var context = PennyDbContext.Create(source);
            context.Receipts.Add(encrypted.Row);
            // Not cancellable: once the file is in place, the outcome must be known.
            await context.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception error)
            when (error is PostgresException
                || error is DbUpdateException { InnerException: PostgresException }
            )
        {
            files.Delete(encrypted.Row.StoragePath);
            throw;
        }
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

    private async Task<StoredReceipt?> OpenAsync(
        Receipt? row,
        CancellationToken cancellationToken
    ) =>
        row is null
            ? null
            : new(
                row.Id,
                files.ReadName(row),
                row.Mime,
                await files.ReadContentAsync(row, cancellationToken)
            );
}
