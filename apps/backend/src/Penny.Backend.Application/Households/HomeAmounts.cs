using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Rates;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// Each member sees a shared expense in their own home currency too (MAZ-151 phase 2,
// contract 2.5.0, `MemberHomeAmounts`). Computed on read, never stored: the rate is home
// units per unit of what was paid (the original currency, or the household's) for the
// expense's date, from the cached ECB rates with the GET /api/rates rules (the latest
// publication on or before the date; after the latest publication, the latest,
// provisionally; a cross rate of the per-euro quotes). Nothing is added when the household
// is in the viewer's currency, or when a rate is needed and none is known (rates turned
// off, nothing cached yet, a date before the first publication or a currency the ECB
// doesn't quote).
public sealed class HomeAmounts(IExchangeRateRepository rates, ExchangeRateSettings settings)
{
    // Expense views (contract `Expense`) as `viewerId` sees them, with their share (0 for
    // a member without one).
    public async Task<IReadOnlyList<ExpenseView>> ExpensesAsync(
        IReadOnlyList<ExpenseView> views,
        string householdCurrency,
        string? home,
        string viewerId,
        CancellationToken cancellationToken
    )
    {
        var amounts = await ForAsync(
            [
                .. views.Select(view => new HomeRequest(
                    householdCurrency,
                    Day(view.Date),
                    view.TotalCents,
                    view.OriginalAmount,
                    view.OriginalCurrency,
                    view.Splits.FirstOrDefault(share =>
                        string.Equals(share.UserId, viewerId, StringComparison.Ordinal)
                    )?.AmountCents
                        ?? 0
                )),
            ],
            home,
            cancellationToken
        );
        return
        [
            .. views.Select(
                (view, index) => amounts[index] is { } amount ? view with { Home = amount } : view
            ),
        ];
    }

    public async Task<ExpenseView> ExpenseAsync(
        ExpenseView view,
        string householdCurrency,
        string? home,
        string viewerId,
        CancellationToken cancellationToken
    ) => (await ExpensesAsync([view], householdCurrency, home, viewerId, cancellationToken))[0];

    // Projected rows (recorded and scheduled), with the share they already carry.
    public async Task<IReadOnlyList<ProjectedExpenseView>> ProjectedAsync(
        IReadOnlyList<ProjectedExpenseView> rows,
        string? home,
        CancellationToken cancellationToken
    )
    {
        var amounts = await ForAsync(
            [
                .. rows.Select(row => new HomeRequest(
                    row.HouseholdCurrency,
                    Day(row.Date),
                    row.TotalCents,
                    row.OriginalAmount,
                    row.OriginalCurrency,
                    row.ShareCents
                )),
            ],
            home,
            cancellationToken
        );
        return
        [
            .. rows.Select(
                (row, index) => amounts[index] is { } amount ? row with { Home = amount } : row
            ),
        ];
    }

    public async Task<IReadOnlyList<MemberHomeView?>> ForAsync(
        IReadOnlyList<HomeRequest> items,
        string? home,
        CancellationToken cancellationToken
    )
    {
        var views = new MemberHomeView?[items.Count];
        if (home is null)
            return views;
        var resolver = new Resolver(rates, settings.Enabled, cancellationToken);
        for (var index = 0; index < items.Count; index++)
        {
            var item = items[index];
            if (string.Equals(item.HouseholdCurrency, home, StringComparison.Ordinal))
                continue;
            var source = item.OriginalCurrency ?? item.HouseholdCurrency;
            var exact = string.Equals(source, home, StringComparison.Ordinal);
            var quote = exact ? null : await resolver.RateAsync(item.Date, source, home);
            if (!exact && quote is null)
                continue;
            MemberHomeAmount? amounts;
            try
            {
                amounts = SharedCurrency.MemberAmounts(
                    item.TotalCents,
                    item.OriginalAmount,
                    item.OriginalCurrency,
                    item.ShareCents,
                    item.HouseholdCurrency,
                    home,
                    quote?.Rate
                );
            }
            catch (OverflowException)
            {
                // An amount no contract integer can hold is left out, like an unknown rate.
                continue;
            }
            if (amounts is null || amounts.TotalCents > LedgerLimits.MaxCents)
                continue;
            views[index] = new(
                home,
                amounts.TotalCents,
                amounts.ShareCents,
                quote?.Rate,
                quote is null ? null
                    : quote.Publication.Provisional ? Currencies.Provisional
                    : Currencies.Published,
                quote is null ? null : LedgerDates.Write(quote.Publication.Date)
            );
        }
        return views;
    }

    private static DateOnly Day(string date) =>
        LedgerDates.TryParse(date, out var day)
            ? day
            : throw new InvalidOperationException("A stored expense date is a ledger date.");

    // Reads each publication once per request.
    private sealed class Resolver(
        IExchangeRateRepository rates,
        bool enabled,
        CancellationToken cancellationToken
    )
    {
        private readonly Dictionary<DateOnly, RatePublication?> publications = [];
        private readonly Dictionary<DateOnly, Dictionary<string, string>> quotes = [];
        private bool latestRead;
        private DateOnly? latest;

        public async Task<HomeRate?> RateAsync(DateOnly date, string from, string to)
        {
            if (!enabled || await PublicationAsync(date) is not { } publication)
                return null;
            if (!quotes.TryGetValue(publication.Date, out var perEuro))
            {
                // Units per euro, the euro itself included.
                perEuro = new(StringComparer.Ordinal) { ["EUR"] = "1" };
                foreach (var rate in await rates.ReadAsync(publication.Date, cancellationToken))
                    if (Currencies.IsCurrency(rate.Currency) && Currencies.ValidRate(rate.PerEuro))
                        perEuro[rate.Currency] = rate.PerEuro;
                quotes[publication.Date] = perEuro;
            }
            return
                perEuro.TryGetValue(from, out var fromPerEuro)
                && perEuro.TryGetValue(to, out var toPerEuro)
                && Currencies.CrossRate(fromPerEuro, toPerEuro) is { } cross
                ? new HomeRate(cross, publication)
                : null;
        }

        private async Task<RatePublication?> PublicationAsync(DateOnly date)
        {
            if (publications.TryGetValue(date, out var known))
                return known;
            if (!latestRead)
            {
                latest = await rates.LatestDateAsync(cancellationToken);
                latestRead = true;
            }
            var onOrBefore =
                latest is { } last && date >= last
                    ? last
                    : await rates.LatestOnOrBeforeAsync(date, cancellationToken);
            var publication = Currencies.PublishedRateDate(
                new[] { onOrBefore, latest }.OfType<DateOnly>(),
                date
            );
            publications[date] = publication;
            return publication;
        }
    }
}
