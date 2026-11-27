using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Rates;

// One refresh of the cached ECB reference rates (MAZ-151). While the cache is empty, or
// its latest publication is more than 60 days old (the server was off for a while), the
// full history is fetched; otherwise the last 90 days, which also picks up the ECB's rare
// corrections. Only the two public files are requested: no account, ledger or personal
// data is sent. A failed or empty download changes nothing and is retried by the worker.
public sealed class ExchangeRateRefresher(
    HttpClient http,
    IExchangeRateRepository rates,
    ExchangeRateSettings settings,
    TimeProvider clock
)
{
    public const string HttpClientName = "exchange-rates";
    public const int StaleDays = 60;

    public async Task<RateRefresh> RunOnceAsync(CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var latest = await rates.LatestDateAsync(cancellationToken);
        var history = latest is not { } last || last < today.AddDays(-StaleDays);
        using var response = await http.GetAsync(
            history ? settings.HistoryUri : settings.RecentUri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken
        );
        response.EnsureSuccessStatusCode();
        using var body = new MemoryStream();
        await using (var stream = await response.Content.ReadAsStreamAsync(cancellationToken))
            await CopyBoundedAsync(stream, body, cancellationToken);
        body.Position = 0;
        var quotes = history ? EcbRates.ReadHistoryZip(body) : EcbRates.ReadDaily(body);
        if (quotes.Count == 0)
            throw new InvalidDataException("The rate source sent no rates.");
        var changed = await rates.UpsertAsync(quotes, cancellationToken);
        return new(history, quotes.Count, changed);
    }

    private static async Task CopyBoundedAsync(
        Stream source,
        MemoryStream target,
        CancellationToken cancellationToken
    )
    {
        var buffer = new byte[81920];
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (target.Length + read > EcbRates.MaxDownloadBytes)
                throw new InvalidDataException("The rate download is too large.");
            await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
    }
}
