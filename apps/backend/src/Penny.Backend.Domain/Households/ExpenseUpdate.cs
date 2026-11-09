namespace Penny.Backend.Domain.Households;

// The legacy update body: the expense fields, the revision the client edited and an
// optional household to move the expense to.
public sealed record ExpenseUpdate(ExpenseInput Input, long Revision, string? TargetHouseholdId);
