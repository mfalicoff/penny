using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ProjectedExpense`. Recorded rows carry `receipt` when one is
// linked; scheduled rows carry `scheduled: true`. `recurringId` is the shared rule
// on previews and on recorded occurrences it recorded. `accountId` reaches only
// the payer.
public sealed record ProjectedExpenseResponse(
    string Id,
    string HouseholdId,
    string HouseholdName,
    string HouseholdCurrency,
    string Title,
    string Date,
    long TotalCents,
    long ShareCents,
    string PayerUserId,
    ExpenseCategoryResponse Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ReceiptResponse? Receipt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Scheduled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId
)
{
    public static ProjectedExpenseResponse From(ProjectedExpenseView expense) =>
        new(
            expense.Id,
            expense.HouseholdId,
            expense.HouseholdName,
            expense.HouseholdCurrency,
            expense.Title,
            expense.Date,
            expense.TotalCents,
            expense.ShareCents,
            expense.PayerUserId,
            ExpenseCategoryResponse.From(expense.Category),
            expense.Note,
            ExpenseResponse.ReceiptFrom(expense.Receipt),
            expense.AccountId,
            expense.Scheduled,
            expense.RecurringId
        );
}
