using Penny.Backend.Application.Rates;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ExchangeRates` (2.4.0): every member is always present; `source`,
// `rateDate` and `latestDate` are null when there is nothing to report.
public sealed record ExchangeRatesResponse(
    bool Enabled,
    string? Source,
    string Base,
    string Date,
    string? RateDate,
    bool Provisional,
    string? LatestDate,
    IReadOnlyDictionary<string, string> Rates
)
{
    public static ExchangeRatesResponse From(ExchangeRatesView view) =>
        new(
            view.Enabled,
            view.Source,
            view.Base,
            LedgerDates.Write(view.Date),
            view.RateDate is { } rateDate ? LedgerDates.Write(rateDate) : null,
            view.Provisional,
            view.LatestDate is { } latest ? LedgerDates.Write(latest) : null,
            new SortedDictionary<string, string>(
                view.Rates.ToDictionary(StringComparer.Ordinal),
                StringComparer.Ordinal
            )
        );
}
