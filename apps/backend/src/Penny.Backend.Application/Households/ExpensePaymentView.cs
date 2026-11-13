namespace Penny.Backend.Application.Households;

// An individual payment of a share; `CreatedAt` is Unix milliseconds.
public sealed record ExpensePaymentView(
    string FromUserId,
    long AmountCents,
    long CreatedAt,
    string CreatedBy
);
