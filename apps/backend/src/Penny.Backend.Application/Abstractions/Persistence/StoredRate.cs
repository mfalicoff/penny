namespace Penny.Backend.Application.Abstractions.Persistence;

// A published reference rate: units of `Currency` per euro on `Date`, canonical.
public sealed record StoredRate(DateOnly Date, string Currency, string PerEuro);
