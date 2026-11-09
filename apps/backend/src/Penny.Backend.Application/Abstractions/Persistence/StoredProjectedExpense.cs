namespace Penny.Backend.Application.Abstractions.Persistence;

// A shared expense in a user's personal projection, with its household's name and
// currency (archived households included).
public sealed record StoredProjectedExpense(
    StoredExpense Expense,
    string HouseholdName,
    string HouseholdCurrency
);
