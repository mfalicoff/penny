namespace Penny.Backend.Api.Contracts;

// Contract schema `ExpensePayment`; `createdAt` is Unix milliseconds.
public sealed record ExpensePaymentResponse(
    string FromUserId,
    long AmountCents,
    long CreatedAt,
    string CreatedBy
);
