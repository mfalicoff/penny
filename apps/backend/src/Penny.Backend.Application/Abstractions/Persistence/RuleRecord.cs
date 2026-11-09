using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// The values a shared recurring rule write stores. `Allocations` is empty for equal
// rules; exact rules carry cents and percentage rules basis points. `AnchorDay` is
// the day of month monthly and yearly occurrences return to after a short month.
public sealed record RuleRecord(
    string Title,
    long TotalCents,
    string PayerId,
    string SplitMode,
    IReadOnlyList<SplitAllocation> Allocations,
    ExpenseCategory Category,
    string Note,
    string? AccountId,
    string? ReceiptId,
    string Frequency,
    DateOnly NextDate,
    int AnchorDay,
    bool Active
);
