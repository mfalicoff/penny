using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Ledgers;

// The `{revision, ledger}` envelope of GET and PUT /api/ledger.
public sealed record LedgerSnapshot(long Revision, LedgerDocument Ledger);
