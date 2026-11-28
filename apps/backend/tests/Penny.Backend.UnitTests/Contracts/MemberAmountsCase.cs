using Penny.Backend.Domain.Households;

namespace Penny.Backend.UnitTests.Contracts;

// One `memberAmounts` call: the expense, the member's share, the household and home
// currencies and the home rate (null when none is known), with the result or the error.
public sealed record MemberAmountsCase(
    string Name,
    MemberAmountsExpense Expense,
    long ShareCents,
    string HouseholdCurrency,
    string Home,
    string? Rate,
    MemberHomeAmount? Expected = null,
    string? Error = null
);
