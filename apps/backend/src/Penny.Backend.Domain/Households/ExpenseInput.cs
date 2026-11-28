using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Households;

// The shared expense body. `Title` and the category name are trimmed; `Note`
// defaults to empty; `Allocations` is null when absent. `Foreign` is the amount paid in another
// currency, typed only: its conversion is checked against the household's currency.
public sealed record ExpenseInput(
    string Title,
    long TotalCents,
    DateOnly Date,
    string PayerUserId,
    string SplitMode,
    IReadOnlyList<SplitAllocation>? Allocations,
    ExpenseCategory Category,
    string Note,
    string? AccountId,
    string? ReceiptId,
    int? TimezoneOffsetMinutes,
    // Contract 2.5.0: paid in another currency than the household's (null otherwise).
    ForeignAmount? Foreign = null
);
