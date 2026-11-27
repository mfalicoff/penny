namespace Penny.Backend.Domain.Ledgers;

// An ISO 4217 currency an entry may be paid in (contract 2.4.0): its code, English name
// and the decimal places of its minor unit (JPY has none, KWD has three).
public sealed record CurrencyInfo(string Code, string Name, int MinorUnits);
