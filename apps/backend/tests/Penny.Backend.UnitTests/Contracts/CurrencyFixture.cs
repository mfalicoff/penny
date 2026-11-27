using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// contracts/fixtures/currency.json (MAZ-151). Parsing typed amounts and rates, the stored
// amounts of a typed entry and re-conversion are client rules; they are decoded as raw
// JSON and checked by the TypeScript and Swift suites only.
public sealed record CurrencyFixture(
    string Generator,
    string Description,
    IReadOnlyList<CurrencyFixtureCurrency> Currencies,
    IReadOnlyList<string> HomeCurrencies,
    JsonElement Parse,
    JsonElement Rates,
    IReadOnlyList<CurrencyConversionCase> Conversions,
    IReadOnlyList<CrossRateCase> CrossRates,
    IReadOnlyList<RateDateCase> RateDates,
    JsonElement EntryAmounts,
    JsonElement Reconversions,
    IReadOnlyList<CurrencyLedgerCase> Ledgers
);
