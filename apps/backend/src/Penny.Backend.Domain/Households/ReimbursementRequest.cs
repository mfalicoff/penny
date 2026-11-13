namespace Penny.Backend.Domain.Households;

// `{fromUserId, toUserId, amountCents}` for POST .../months/{month}/reimbursements.
public sealed record ReimbursementRequest(string FromUserId, string ToUserId, long AmountCents);
