using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// An active shared recurring rule as the projection previews it, with its household's
// name and currency. `AccountId` is the payer's private account.
public sealed record StoredSharedRule(
    string Id,
    string HouseholdId,
    string HouseholdName,
    string HouseholdCurrency,
    string Title,
    long TotalCents,
    string PayerId,
    string SplitMode,
    IReadOnlyList<SplitAllocation> Allocations,
    ExpenseCategory Category,
    string Note,
    string? AccountId,
    string Frequency,
    DateOnly NextDate,
    int AnchorDay
);
