namespace Penny.Backend.Domain.Households;

// One signed amount for a member in a month (`YYYY-MM`). Positive means the household
// owes the member: a payer's total, or a reimbursement the member paid. Negative is a
// member's share, or a reimbursement the member received.
public sealed record BalanceContribution(string Month, string UserId, long Cents);
