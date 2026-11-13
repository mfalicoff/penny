namespace Penny.Backend.Domain.Ledgers;

// A validated `PUT /api/ledger` body, already upgraded to version 4. SourceVersion
// and OmittedTrips let the application refuse old clients that would erase data
// they cannot see.
public sealed record LedgerWrite(
    long Revision,
    int SourceVersion,
    bool OmittedTrips,
    LedgerDocument Ledger
);
