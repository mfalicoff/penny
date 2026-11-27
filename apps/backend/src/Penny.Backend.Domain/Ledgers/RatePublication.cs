namespace Penny.Backend.Domain.Ledgers;

// The publication whose rates apply to a date (`publishedRateDate`): the latest on or
// before it, or the latest of all, provisionally, for a date after every publication.
public sealed record RatePublication(DateOnly Date, bool Provisional);
