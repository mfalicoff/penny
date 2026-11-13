namespace Penny.Backend.Domain.Ledgers;

// A validated `PUT /api/ledger` body: the revision the client edited and its v4 ledger.
public sealed record LedgerWrite(long Revision, LedgerDocument Ledger);
