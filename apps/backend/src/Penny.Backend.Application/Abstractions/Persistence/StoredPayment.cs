namespace Penny.Backend.Application.Abstractions.Persistence;

// An individual expense payment: a reimbursement row linked to the expense.
public sealed record StoredPayment(
    string FromUserId,
    long AmountCents,
    DateTimeOffset CreatedAt,
    string CreatedBy
);
