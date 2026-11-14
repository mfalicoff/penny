namespace Penny.Backend.Domain.Households;

// The shared expense body. `Title` and the category name are trimmed; `Note`
// defaults to empty; `Allocations` is null when absent.
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
    int? TimezoneOffsetMinutes
);
