namespace Penny.Backend.Application.Abstractions.Persistence;

// How a purchase left To review: `added` (a new entry or shared expense), `attached` (to
// an entry that already existed) or `discarded`. Entry and household ids are references
// for display only: the entry itself is saved by the normal ledger or expense save.
public sealed record PurchaseResolution(string Outcome, string? EntryId, string? HouseholdId);
