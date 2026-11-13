namespace Penny.Backend.Application.Abstractions.Persistence;

public interface ILedgerRepository
{
    Task<StoredLedger?> ReadAsync(string userId, CancellationToken cancellationToken);

    // Replaces the ledger's rows with `ledger` if the stored revision still equals
    // `expectedRevision`, then increments it, all in one transaction. Before any row
    // changes, `verify` receives the cross-aggregate facts read inside that
    // transaction (after the ledger row is locked when the revision matches); an
    // exception from it rolls everything back. False means a stale revision or a
    // missing ledger; the application maps it to HTTP 409. The caller validates the
    // document, so it never references a removed account, trip or category.
    Task<bool> TrySaveAsync(
        string userId,
        long expectedRevision,
        StoredLedger ledger,
        Action<LedgerWriteState> verify,
        CancellationToken cancellationToken
    );
}
