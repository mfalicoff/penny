using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// The values a create or update writes to an expense and its splits. Bookkeeping
// (revision, creator, timestamps) is set by the repository method that writes it.
// `RecurringId` links an occurrence the runner records to its rule (MAZ-59).
public sealed record ExpenseRecord(
    string HouseholdId,
    string Title,
    long TotalCents,
    DateOnly Date,
    string PayerId,
    string SplitMode,
    ExpenseCategory Category,
    string Note,
    string? AccountId,
    string? ReceiptId,
    IReadOnlyList<SplitShare> Splits,
    string? RecurringId = null
);
