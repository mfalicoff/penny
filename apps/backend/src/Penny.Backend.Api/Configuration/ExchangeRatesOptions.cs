using Penny.Backend.Application.Rates;

namespace Penny.Backend.Api.Configuration;

// Reference exchange rates (MAZ-151, docs/reference/exchange-rates.md). On by default:
// the server fetches the European Central Bank's public reference rates and caches them
// in PostgreSQL. `ExchangeRates__Enabled=false` turns fetching and GET /api/rates' rates
// off (clients then ask people for the rate). `ExchangeRates__Worker=false` stops this
// process from fetching while it still answers from the cache (another process may
// fetch; any number may). `ExchangeRates__RefreshMinutes` is the delay between fetches
// (default 240), also after a failure. `ExchangeRates__HistoryUrl` and
// `ExchangeRates__RecentUrl` replace the ECB's full-history ZIP and 90-day XML, for a
// mirror.
public sealed record ExchangeRatesOptions(
    ExchangeRateSettings Settings,
    bool Worker,
    TimeSpan RefreshInterval
)
{
    public static ExchangeRatesOptions Read(IConfiguration configuration)
    {
        var enabled = Flag(configuration, "ExchangeRates:Enabled");
        var worker = Flag(configuration, "ExchangeRates:Worker");
        return new(
            new ExchangeRateSettings(
                enabled,
                Url(
                    configuration,
                    "ExchangeRates:HistoryUrl",
                    ExchangeRateSettings.DefaultHistoryUri
                ),
                Url(configuration, "ExchangeRates:RecentUrl", ExchangeRateSettings.DefaultRecentUri)
            ),
            worker,
            TimeSpan.FromMinutes(
                BackendOptions.ReadBounded(
                    configuration,
                    "ExchangeRates:RefreshMinutes",
                    240,
                    15,
                    10080
                )
            )
        );
    }

    private static bool Flag(IConfiguration configuration, string key) =>
        configuration[key] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException($"{key} must be true or false."),
        };

    private static Uri Url(IConfiguration configuration, string key, Uri fallback)
    {
        var text = configuration[key];
        if (string.IsNullOrWhiteSpace(text))
            return fallback;
        if (
            !Uri.TryCreate(text, UriKind.Absolute, out var url)
            || url.Scheme is not ("https" or "http")
        )
            throw new InvalidOperationException($"{key} must be an absolute http(s) URL.");
        return url;
    }
}
