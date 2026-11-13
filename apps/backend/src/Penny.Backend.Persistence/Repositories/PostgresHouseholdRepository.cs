using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresHouseholdRepository(NpgsqlDataSource source) : IHouseholdRepository
{
    // One snapshot for every query of a read (a detail and its members agree).
    public Task<T> ReadAsync<T>(
        Func<IHouseholdTransaction, Task<T>> work,
        CancellationToken cancellationToken
    ) => RunAsync(IsolationLevel.RepeatableRead, work, cancellationToken);

    // READ COMMITTED with explicit row locks (see PostgresHouseholdTransaction). Each
    // statement sees every commit made before it, so checks made after taking a lock
    // see the state the commit will be based on. Disposing without commit rolls back
    // (failures, cancellation and errors alike).
    public Task<T> WriteAsync<T>(
        Func<IHouseholdTransaction, Task<T>> work,
        CancellationToken cancellationToken
    ) => RunAsync(IsolationLevel.ReadCommitted, work, cancellationToken);

    private async Task<T> RunAsync<T>(
        IsolationLevel isolation,
        Func<IHouseholdTransaction, Task<T>> work,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            isolation,
            cancellationToken
        );
        var result = await work(new PostgresHouseholdTransaction(context, cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return result;
    }
}
