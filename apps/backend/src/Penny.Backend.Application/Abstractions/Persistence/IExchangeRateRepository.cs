namespace Penny.Backend.Application.Abstractions.Persistence;

// The cached ECB reference rates (MAZ-151), shared by every user.
public interface IExchangeRateRepository
{
    // The latest publication stored, or null before the first fetch.
    Task<DateOnly?> LatestDateAsync(CancellationToken cancellationToken);

    // The latest publication on or before `date`, or null when none is.
    Task<DateOnly?> LatestOnOrBeforeAsync(DateOnly date, CancellationToken cancellationToken);

    // Every quote of one publication.
    Task<IReadOnlyList<StoredRate>> ReadAsync(DateOnly date, CancellationToken cancellationToken);

    // Inserts new quotes and replaces changed ones in one transaction; returns how many
    // rows changed. Idempotent, so any number of processes may refresh.
    Task<int> UpsertAsync(IReadOnlyList<StoredRate> rates, CancellationToken cancellationToken);
}
