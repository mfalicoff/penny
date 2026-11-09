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
}
