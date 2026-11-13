using System.Globalization;

namespace Penny.Backend.Domain.Households;

// Monthly settlement rules: balances, suggested reimbursements, overdue months and
// the month-end cutoff for recording a reimbursement. Months are independent: a
// credit in one month never offsets a debt in another. Integer cents only, ordinal id
// order.
public static class MonthlySettlement
{
    // An expense's contributions: the payer is credited the total and each member is
    // debited their share (zero shares included, so the member still has a balance).
    public static IEnumerable<BalanceContribution> Expense(
        string month,
        string payerId,
        long totalCents,
        IEnumerable<SplitShare> splits
    )
    {
        yield return new(month, payerId, totalCents);
        foreach (var share in splits)
            yield return new(month, share.UserId, -share.AmountCents);
    }

    // A reimbursement (monthly or an individual expense payment) credits the sender
    // and debits the recipient.
    public static IEnumerable<BalanceContribution> Reimbursement(
        string month,
        string fromUserId,
        string toUserId,
        long amountCents
    )
    {
        yield return new(month, fromUserId, amountCents);
        yield return new(month, toUserId, -amountCents);
    }

    // Every member with a contribution in `month`,
    // ordered by id. Contributions of other months are ignored.
    public static IReadOnlyList<MemberBalance> Balances(
        string month,
        IEnumerable<BalanceContribution> contributions
    )
    {
        var balances = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var contribution in contributions)
            if (string.Equals(contribution.Month, month, StringComparison.Ordinal))
                balances[contribution.UserId] = checked(
                    balances.GetValueOrDefault(contribution.UserId) + contribution.Cents
                );
        return
        [
            .. balances
                .OrderBy(balance => balance.Key, StringComparer.Ordinal)
                .Select(balance => new MemberBalance(balance.Key, balance.Value)),
        ];
    }

    // Months (`YYYY-MM`) in which some member's balance is not zero, ascending.
    public static IReadOnlyList<string> UnsettledMonths(
        IEnumerable<BalanceContribution> contributions
    )
    {
        var balances = new Dictionary<(string Month, string UserId), long>();
        foreach (var contribution in contributions)
        {
            var key = (contribution.Month, contribution.UserId);
            balances[key] = checked(balances.GetValueOrDefault(key) + contribution.Cents);
        }
        return
        [
            .. balances
                .Where(balance => balance.Value != 0)
                .Select(balance => balance.Key.Month)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal),
        ];
    }

    // Greedy matching of the largest debtor with the
    // largest creditor (ties by id), at most debtors + creditors - 1 full transfers.
    // Balances must name each member once and net to zero.
    public static IReadOnlyList<SuggestedReimbursement> Suggest(
        IReadOnlyList<MemberBalance> balances
    )
    {
        if (
            balances.Select(item => item.UserId).Distinct(StringComparer.Ordinal).Count()
            != balances.Count
        )
            throw new ArgumentException(
                "Balances must contain each member once.",
                nameof(balances)
            );
        if (balances.Aggregate(0L, (sum, item) => checked(sum + item.BalanceCents)) != 0)
            throw new ArgumentException("Household balances must net to zero.", nameof(balances));
        var debtors = Side(balances.Where(item => item.BalanceCents < 0), -1);
        var creditors = Side(balances.Where(item => item.BalanceCents > 0), 1);
        var suggestions = new List<SuggestedReimbursement>();
        int debtor = 0,
            creditor = 0;
        while (debtor < debtors.Count && creditor < creditors.Count)
        {
            var amount = Math.Min(debtors[debtor].Cents, creditors[creditor].Cents);
            suggestions.Add(new(debtors[debtor].UserId, creditors[creditor].UserId, amount));
            debtors[debtor].Cents -= amount;
            creditors[creditor].Cents -= amount;
            if (debtors[debtor].Cents == 0)
                debtor++;
            if (creditors[creditor].Cents == 0)
                creditor++;
        }
        return suggestions;
    }

    // Overdue: an earlier month (UTC) that still has a suggestion.
    public static bool IsOverdue(string month, string currentMonth, bool hasSuggestions) =>
        hasSuggestions && string.CompareOrdinal(month, currentMonth) < 0;

    // The month's last calendar day. Monthly reimbursements are recorded on that UTC
    // day or later, once every expense of the month can be known.
    public static DateOnly LastDay(string month)
    {
        var year = int.Parse(month.AsSpan(0, 4), CultureInfo.InvariantCulture);
        var number = int.Parse(month.AsSpan(5, 2), CultureInfo.InvariantCulture);
        return new DateOnly(year, number, DateTime.DaysInMonth(year, number));
    }

    // Cutoff: `today < lastDay` refuses. `today` is the UTC calendar day.
    public static bool CanRecord(string month, DateOnly today) => today >= LastDay(month);

    public static string MonthOf(DateOnly date) =>
        date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    public static string MonthOf(DateTimeOffset instant) =>
        instant.UtcDateTime.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    private static List<Amount> Side(IEnumerable<MemberBalance> balances, int sign) =>
        [
            .. balances
                .Select(item => new Amount(item.UserId, sign * item.BalanceCents))
                .OrderByDescending(item => item.Cents)
                .ThenBy(item => item.UserId, StringComparer.Ordinal),
        ];

    private sealed class Amount(string userId, long cents)
    {
        public string UserId { get; } = userId;

        public long Cents { get; set; } = cents;
    }
}
