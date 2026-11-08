namespace Penny.Backend.Application.Abstractions.Persistence;

// Household storage as units of work. `ReadAsync` runs on one consistent snapshot;
// `WriteAsync` runs one READ COMMITTED transaction that commits only when `work`
// completes. Any exception (including a BackendFailure) or cancellation rolls back
// every change the work made.
public interface IHouseholdRepository
{
    Task<T> ReadAsync<T>(
        Func<IHouseholdTransaction, Task<T>> work,
        CancellationToken cancellationToken
    );

    Task<T> WriteAsync<T>(
        Func<IHouseholdTransaction, Task<T>> work,
        CancellationToken cancellationToken
    );
}
