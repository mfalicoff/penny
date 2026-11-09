using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// The legacy `expense()` view (src/data/households.ts `HouseholdExpense`), also the
// audit payload of expense events. Instants are Unix milliseconds. `AccountId` is the
// payer's private account: present only when the viewer is the payer, never in audit.
public sealed record ExpenseView(
    string Id,
    string HouseholdId,
    string Title,
    long TotalCents,
    string Date,
    string PayerUserId,
    string SplitMode,
    IReadOnlyList<SplitShare> Splits,
    IReadOnlyList<ExpensePaymentView> Payments,
    bool PaymentsClosed,
    ExpenseCategory Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReceiptId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ExpenseReceiptView? Receipt,
    long Revision,
    string CreatedBy,
    long CreatedAt,
    string UpdatedBy,
    long UpdatedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId
)
{
    public static ExpenseView From(StoredExpense expense, string viewerId) =>
        new(
            expense.Id,
            expense.HouseholdId,
            expense.Title,
            expense.TotalCents,
            LedgerDates.Write(expense.Date),
            expense.PayerId,
            expense.SplitMode,
            expense.Splits,
            [
                .. expense.Payments.Select(payment => new ExpensePaymentView(
                    payment.FromUserId,
                    payment.AmountCents,
                    payment.CreatedAt.ToUnixTimeMilliseconds(),
                    payment.CreatedBy
                )),
            ],
            expense.PaymentsClosed,
            expense.Category,
            expense.Note,
            string.Equals(viewerId, expense.PayerId, StringComparison.Ordinal)
                ? expense.AccountId
                : null,
            expense.Receipt?.Id,
            expense.Receipt is { } receipt
                ? ExpenseReceiptView.From(receipt.Id, receipt.Name, receipt.Mime)
                : null,
            expense.Revision,
            expense.CreatedBy,
            expense.CreatedAt.ToUnixTimeMilliseconds(),
            expense.UpdatedBy,
            expense.UpdatedAt.ToUnixTimeMilliseconds(),
            expense.RecurringId
        );

    // Legacy audit payloads drop the payer's account (`{...view, accountId: undefined}`).
    public ExpenseView ForAudit() =>
        this with
        {
            AccountId = null,
            Receipt = Receipt is null ? null : Receipt with { Name = null },
        };
}
