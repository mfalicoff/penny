namespace Penny.Backend.Domain.Households;

// `{fromUserId, revision}` for POST .../expenses/{expenseId}/payments.
public sealed record PaymentRequest(string FromUserId, long Revision);
