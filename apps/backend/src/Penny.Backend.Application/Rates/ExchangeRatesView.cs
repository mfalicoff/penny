namespace Penny.Backend.Application.Rates;

// The answer to GET /api/rates (contract schema `ExchangeRates`): `Rates` maps each quoted
// currency to the base units one unit of it is worth, canonical, A–Z by code.
public sealed record ExchangeRatesView(
    bool Enabled,
    string? Source,
    string Base,
    DateOnly Date,
    DateOnly? RateDate,
    bool Provisional,
    DateOnly? LatestDate,
    IReadOnlyList<KeyValuePair<string, string>> Rates
);
