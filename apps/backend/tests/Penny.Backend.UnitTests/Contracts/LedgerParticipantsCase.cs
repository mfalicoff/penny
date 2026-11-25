namespace Penny.Backend.UnitTests.Contracts;

// A personal entry or rule (`List` is "transaction" or "recurring") of `Kind` with an
// optional participant count; null means the field is absent. Counts may be
// deliberately invalid numbers (fractions, out of range).
public sealed record LedgerParticipantsCase(
    string Kind,
    string List,
    decimal? Participants,
    bool Valid
);
