namespace Penny.Backend.Application.Rates;

// Reference exchange rates (MAZ-151, docs/reference/exchange-rates.md). With `Enabled`
// false nothing is fetched and GET /api/rates answers `enabled: false`. `HistoryUri` is
// the ECB's full history (a zipped CSV, fetched while the cache is empty or stale),
// `RecentUri` its last 90 days (XML, every refresh after that).
public sealed record ExchangeRateSettings(bool Enabled, Uri HistoryUri, Uri RecentUri)
{
    public const string Source = "European Central Bank";

    public static readonly Uri DefaultHistoryUri = new(
        "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip"
    );

    public static readonly Uri DefaultRecentUri = new(
        "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
    );
}
