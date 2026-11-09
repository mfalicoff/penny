using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

// Same transaction discipline as PostgresHouseholdRepository: reads share one
// REPEATABLE READ snapshot; writes run READ COMMITTED with explicit row locks, and
// disposing without commit rolls back (failures, cancellation and errors alike).
public sealed class PostgresSharedExpenseRepository(NpgsqlDataSource source, ReceiptFileStore files)
    : ISharedExpenseRepository
{
    public Task<T> ReadAsync<T>(
        Func<ISharedExpenseTransaction, Task<T>> work,
        CancellationToken cancellationToken
    ) => RunAsync(IsolationLevel.RepeatableRead, work, cancellationToken);

    public Task<T> WriteAsync<T>(
        Func<ISharedExpenseTransaction, Task<T>> work,
        CancellationToken cancellationToken
    ) => RunAsync(IsolationLevel.ReadCommitted, work, cancellationToken);

    private async Task<T> RunAsync<T>(
        IsolationLevel isolation,
        Func<ISharedExpenseTransaction, Task<T>> work,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            isolation,
            cancellationToken
        );
        var result = await work(
            new PostgresSharedExpenseTransaction(context, files, cancellationToken)
        );
        await transaction.CommitAsync(cancellationToken);
        return result;
    }
}
