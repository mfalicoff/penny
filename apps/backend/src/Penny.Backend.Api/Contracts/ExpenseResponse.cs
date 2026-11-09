using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Expense` (legacy `HouseholdExpense`). Optional fields are omitted
// when absent; `accountId` is present only for the payer.
public sealed record ExpenseResponse(
    string Id,
    string HouseholdId,
    string Title,
    long TotalCents,
    string Date,
    string PayerUserId,
    string SplitMode,
    IReadOnlyList<ExpenseSplitResponse> Splits,
    IReadOnlyList<ExpensePaymentResponse> Payments,
    bool PaymentsClosed,
    ExpenseCategoryResponse Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReceiptId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ReceiptResponse? Receipt,
    long Revision,
    string CreatedBy,
    long CreatedAt,
    string UpdatedBy,
    long UpdatedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId
)
{
    public static ExpenseResponse From(ExpenseView expense) =>
        new(
            expense.Id,
            expense.HouseholdId,
            expense.Title,
            expense.TotalCents,
            expense.Date,
            expense.PayerUserId,
            expense.SplitMode,
            [
                .. expense.Splits.Select(share => new ExpenseSplitResponse(
                    share.UserId,
                    share.AmountCents
                )),
            ],
            [
                .. expense.Payments.Select(payment => new ExpensePaymentResponse(
                    payment.FromUserId,
                    payment.AmountCents,
                    payment.CreatedAt,
                    payment.CreatedBy
                )),
            ],
            expense.PaymentsClosed,
            ExpenseCategoryResponse.From(expense.Category),
            expense.Note,
            expense.AccountId,
            expense.ReceiptId,
            ReceiptFrom(expense.Receipt),
            expense.Revision,
            expense.CreatedBy,
            expense.CreatedAt,
            expense.UpdatedBy,
            expense.UpdatedAt,
            expense.RecurringId
        );

    public static ReceiptResponse? ReceiptFrom(ExpenseReceiptView? receipt) =>
        receipt is null ? null : new(receipt.Id, receipt.Name ?? "", receipt.Mime, receipt.Uri);
}
