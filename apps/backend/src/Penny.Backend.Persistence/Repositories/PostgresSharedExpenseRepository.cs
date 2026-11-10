using System.Data;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

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

    public async Task<IReadOnlyList<RuleClaim>> ClaimRulesAsync(
        string leaseOwner,
        string leaseToken,
        DateOnly today,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<HouseholdRecurring, bool>> due = rule =>
            rule.Active
            && rule.NextDate <= today
            && (rule.LeaseExpiresAt == null || rule.LeaseExpiresAt <= now);
        // Candidates first (the partial due index), then one conditional update: the
        // row lock serializes competing claims, and a loser re-checks `due` against the
        // winner's lease and skips the row. Archiving is final, so archived households'
        // rules are never claimed.
        var candidates = await context
            .HouseholdRecurring.AsNoTracking()
            .Where(due)
            .Where(rule =>
                context.Households.Any(household =>
                    household.Id == rule.HouseholdId && household.ArchivedAt == null
                )
            )
            .OrderBy(rule => rule.NextDate)
            .ThenBy(rule => rule.Id)
            .Take(limit)
            .Select(rule => rule.Id)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await context
            .HouseholdRecurring.Where(rule => candidates.Contains(rule.Id))
            .Where(due)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(rule => rule.LeaseOwner, leaseOwner)
                        .SetProperty(rule => rule.LeaseToken, leaseToken)
                        .SetProperty(rule => rule.LeaseExpiresAt, leaseUntil),
                cancellationToken
            );
        return await context
            .HouseholdRecurring.AsNoTracking()
            .Where(rule => candidates.Contains(rule.Id) && rule.LeaseToken == leaseToken)
            .OrderBy(rule => rule.NextDate)
            .ThenBy(rule => rule.Id)
            .Select(rule => new RuleClaim(rule.Id, rule.HouseholdId, rule.NextDate))
            .ToListAsync(cancellationToken);
    }

    public async Task ReleaseRuleAsync(
        string ruleId,
        string leaseToken,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .HouseholdRecurring.Where(rule => rule.Id == ruleId && rule.LeaseToken == leaseToken)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(rule => rule.LeaseOwner, (string?)null)
                        .SetProperty(rule => rule.LeaseToken, (string?)null)
                        .SetProperty(rule => rule.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
    }

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
