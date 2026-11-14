using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// A live shared expense with everything its view needs: splits ordered by
// member id, individual payments ordered by time then debtor, whether the month has
// a monthly reimbursement (`PaymentsClosed`), and the receipt's name and MIME when one
// is linked. `AccountId` is the payer's private account and must only reach the payer.
public sealed record StoredExpense(
    string Id,
    string HouseholdId,
    string Title,
    long TotalCents,
    DateOnly Date,
    string PayerId,
    string SplitMode,
    ExpenseCategory Category,
    string Note,
    string? AccountId,
    StoredReceiptInfo? Receipt,
    string? RecurringId,
    long Revision,
    string CreatedBy,
    DateTimeOffset CreatedAt,
    string UpdatedBy,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<SplitShare> Splits,
    IReadOnlyList<StoredPayment> Payments,
    bool PaymentsClosed
);
