namespace Penny.Backend.Application.Abstractions.Persistence;

// Shared-expense storage as units of work, with the same guarantees as
// IHouseholdRepository: `ReadAsync` runs on one consistent snapshot; `WriteAsync`
// runs one READ COMMITTED transaction that commits only when `work` completes, and
// any exception or cancellation rolls back everything, audit and outbox included.
public interface ISharedExpenseRepository
{
    Task<T> ReadAsync<T>(
        Func<ISharedExpenseTransaction, Task<T>> work,
        CancellationToken cancellationToken
    );

    Task<T> WriteAsync<T>(
        Func<ISharedExpenseTransaction, Task<T>> work,
        CancellationToken cancellationToken
    );

    // Leases up to `limit` active rules of unarchived households that are due on or
    // before `today` (earliest first) to `leaseToken` until `leaseUntil`, in one short
    // transaction. Rules leased to another runner whose lease has not expired are
    // skipped, so two runners never own one rule; an expired lease (a runner that
    // died) is taken over. `leaseOwner` names the process for diagnostics.
    Task<IReadOnlyList<RuleClaim>> ClaimRulesAsync(
        string leaseOwner,
        string leaseToken,
        DateOnly today,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    );

    // Gives up the lease if `leaseToken` still holds it.
    Task ReleaseRuleAsync(string ruleId, string leaseToken, CancellationToken cancellationToken);
}
