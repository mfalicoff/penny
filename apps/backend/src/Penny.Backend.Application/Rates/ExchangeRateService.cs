using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Rates;

// GET /api/rates (MAZ-151): the cached ECB reference rates for a date, quoted in a base
// currency. The publication is the latest on or before the date (`publishedRateDate`);
// a date after the latest publication takes the latest, provisionally. Every rate is a
// cross rate of the ECB's per-euro quotes (`crossRate`): base units per one unit of the
// other currency, 6 significant digits. A base the ECB doesn't quote gets no rates.
public sealed class ExchangeRateService(
    IExchangeRateRepository rates,
    ExchangeRateSettings settings,
    TimeProvider clock
)
{
    public const string InvalidRequest = "Invalid exchange rate request.";

    public async Task<ExchangeRatesView> GetAsync(
        string? currency,
        string? date,
        CancellationToken cancellationToken
    )
    {
        if (currency is null || !Currencies.IsCurrency(currency))
            throw Invalid();
        DateOnly? asked = null;
        if (date is not null)
            asked = LedgerDates.TryParse(date, out var parsed) ? parsed : throw Invalid();
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (!settings.Enabled)
            return new(false, null, currency, asked ?? today, null, false, null, []);

        var latest = await rates.LatestDateAsync(cancellationToken);
        // Without a date: the latest publication itself.
        var day = asked ?? latest ?? today;
        var onOrBefore =
            latest is { } last && day >= last
                ? last
                : await rates.LatestOnOrBeforeAsync(day, cancellationToken);
        var publication = Currencies.PublishedRateDate(
            new[] { onOrBefore, latest }.OfType<DateOnly>(),
            day
        );
        if (publication is null)
            return new(true, ExchangeRateSettings.Source, currency, day, null, false, latest, []);

        // Units per euro, the euro itself included.
        var perEuro = new Dictionary<string, string>(StringComparer.Ordinal) { ["EUR"] = "1" };
        foreach (var rate in await rates.ReadAsync(publication.Date, cancellationToken))
            if (Currencies.IsCurrency(rate.Currency) && Currencies.ValidRate(rate.PerEuro))
                perEuro[rate.Currency] = rate.PerEuro;
        var quoted = new List<KeyValuePair<string, string>>();
        if (perEuro.TryGetValue(currency, out var basePerEuro))
            foreach (
                var (code, otherPerEuro) in perEuro.OrderBy(
                    pair => pair.Key,
                    StringComparer.Ordinal
                )
            )
                if (code != currency && Currencies.CrossRate(otherPerEuro, basePerEuro) is { } rate)
                    quoted.Add(new(code, rate));
        return new(
            true,
            ExchangeRateSettings.Source,
            currency,
            day,
            publication.Date,
            publication.Provisional,
            latest,
            quoted
        );
    }

    private static BackendFailure Invalid() =>
        new(FailureKind.Invalid, ErrorCodes.RatesInvalidRequest, InvalidRequest);
}
