namespace Penny.Backend.Domain.Households;

// The settlement rules that gate membership exits (legacy `calculateMonthlyBalances`
// over every month with expenses or reimbursements). Months are independent: a debt
// in one month is never offset by a credit in another.
public static class HouseholdSettlement
{
    // Legacy `canLeave`: the member's balance is zero in every month.
    public static bool IsSettled(IEnumerable<BalanceContribution> contributions, string userId) =>
        Net(contributions)
            .All(balance =>
                !string.Equals(balance.Key.UserId, userId, StringComparison.Ordinal)
                || balance.Value == 0
            );

    // Legacy archive check: no month has a suggested reimbursement, that is, every
    // member's balance is zero in every month (balances always net to zero).
    public static bool IsSettled(IEnumerable<BalanceContribution> contributions) =>
        Net(contributions).All(balance => balance.Value == 0);

    private static Dictionary<(string Month, string UserId), long> Net(
        IEnumerable<BalanceContribution> contributions
    )
    {
        var balances = new Dictionary<(string Month, string UserId), long>();
        foreach (var contribution in contributions)
        {
            var key = (contribution.Month, contribution.UserId);
            balances[key] = checked(balances.GetValueOrDefault(key) + contribution.Cents);
        }
        return balances;
    }
}
