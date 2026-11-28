using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// The total and foreign-amount fields of a shared expense in a household's currency, and
// the `sharedExpenseCurrencyProblem` message (null when they're fine).
public sealed record SharedExpenseCurrencyCase(
    string Name,
    string HouseholdCurrency,
    JsonElement Expense,
    string? Problem
);
