namespace Penny.Backend.Application.Abstractions.Persistence;

// A `household_reimbursements` row. `ExpenseId` is set for an individual expense
// payment and null for a monthly reimbursement.
public sealed record StoredReimbursement(
    string Id,
    string HouseholdId,
    string Month,
    string FromUserId,
    string ToUserId,
    long AmountCents,
    string CreatedBy,
    DateTimeOffset CreatedAt,
    string? ExpenseId
);
