using Penny.Backend.Application.Ledgers;

namespace Penny.Backend.Api.Contracts;

// The `Snapshot` envelope: `{revision, ledger}`.
public sealed record LedgerSnapshotResponse(long Revision, LedgerResponse Ledger)
{
    public static LedgerSnapshotResponse From(LedgerSnapshot snapshot) =>
        new(snapshot.Revision, LedgerResponse.From(snapshot.Ledger));
}
