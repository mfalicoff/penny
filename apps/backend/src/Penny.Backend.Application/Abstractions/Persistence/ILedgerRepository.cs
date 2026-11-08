namespace Penny.Backend.Application.Abstractions.Persistence;

public interface ILedgerRepository
{
    Task<StoredLedger?> ReadAsync(string userId, CancellationToken cancellationToken);

    // Replaces the ledger's rows with `ledger` if the stored revision still equals
    // `expectedRevision`, then increments it. The caller validates the document and
    // clears references to removed accounts/trips first. False means a stale
    // revision or missing ledger; the application maps a stale save to HTTP 409.
    Task<bool> TrySaveAsync(
        string userId,
        long expectedRevision,
        StoredLedger ledger,
        CancellationToken cancellationToken
    );
}
