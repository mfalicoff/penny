using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Households;

// Shared expenses in several currencies (MAZ-151 phase 2, contract 2.5.0), ported from
// apps/web/src/domain/households.ts; contracts/fixtures/shared-currency.json holds the
// golden cases (SharedCurrencyFixtureTests). A household's (or shared trip's) currency is
// the one its balances and settle-up use. A shared expense paid in another currency also
// carries the amount paid, that currency and the rate (household units per unit); its
// total and splits are that amount converted at the expense date's rate, so balances never
// move later. Each member sees the expense in their own home currency too.
public static class SharedCurrency
{
    // Why the foreign-amount fields of a shared expense are invalid, or null when they're
    // fine (`sharedExpenseCurrencyProblem`): the personal entry rules, with the household's
    // currency in place of the home currency.
    public static string? ExpenseProblem(
        long totalCents,
        ForeignAmount? foreign,
        string householdCurrency
    ) =>
        Currencies.ForeignAmountProblem(
            totalCents,
            foreign?.OriginalAmount,
            foreign?.OriginalCurrency,
            foreign?.Rate,
            foreign?.RateStatus,
            foreign?.RateDate,
            householdCurrency
        );

    // A member's view of a shared expense in their home currency (`memberAmounts`). The
    // expense converts from what was paid (its original amount, or its total when it was
    // paid in the household's currency) at `rate`, the home units per unit of that
    // currency for the expense's date, rounded once, half up. Paid in the home currency,
    // the amount is exact and no rate is needed. The share keeps its proportion of the
    // total (half up), so a whole share stays whole. Null when a rate is needed and none
    // is known.
    public static MemberHomeAmount? MemberAmounts(
        long totalCents,
        long? originalAmount,
        string? originalCurrency,
        long shareCents,
        string householdCurrency,
        string home,
        string? rate
    )
    {
        var source = originalCurrency ?? householdCurrency;
        var amount = originalAmount ?? totalCents;
        long total;
        if (string.Equals(householdCurrency, home, StringComparison.Ordinal))
            total = totalCents;
        else if (string.Equals(source, home, StringComparison.Ordinal))
            total = amount;
        else if (rate is null)
            return null;
        else
            total = Currencies.ConvertAmount(amount, source, rate, home);
        return new(total, Currencies.ProportionHalfUp(shareCents, totalCents, total));
    }

    // Balances and suggested payments shown in another currency (`settleIn`, "Settle
    // in"), at one rate (`to` units per unit of `from`, today's). Payments are suggested
    // in the household's currency first, then each figure is converted on its own, half
    // up, keeping its sign. Recording a payment still records the household-currency
    // amount.
    public static SettledIn SettleIn(
        IReadOnlyList<MemberBalance> balances,
        string from,
        string to,
        string rate
    )
    {
        var suggestions = MonthlySettlement.Suggest(balances);
        long Convert(long value)
        {
            if (string.Equals(from, to, StringComparison.Ordinal))
                return value;
            var converted = Currencies.ConvertAmount(Math.Abs(value), from, rate, to);
            return value < 0 ? -converted : converted;
        }
        return new(
            [
                .. balances.Select(item => new MemberBalance(
                    item.UserId,
                    Convert(item.BalanceCents)
                )),
            ],
            [.. suggestions.Select(item => item with { AmountCents = Convert(item.AmountCents) })]
        );
    }
}
