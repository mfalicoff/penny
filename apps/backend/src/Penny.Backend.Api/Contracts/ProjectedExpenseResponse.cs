using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ProjectedExpense`. Recorded rows carry `receipt` when one is
// linked; scheduled rows carry `scheduled: true`. `recurringId` is the shared rule
// on previews and on recorded occurrences it recorded. `accountId` reaches only
// the payer. `payer` is who paid and `paidByYou` whether that is the viewer.
// Contract 2.6.0: what was paid in another currency, and `home`, the viewer's amounts in
// their own currency.
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
    ExpensePayerResponse Payer,
    bool PaidByYou,
    ExpenseCategoryResponse Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ReceiptResponse? Receipt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Scheduled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? OriginalAmount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        string? OriginalCurrency,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Rate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateStatus,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateDate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        MemberHomeAmountsResponse? Home
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
            ExpensePayerResponse.From(expense.Payer),
            expense.PaidByYou,
            ExpenseCategoryResponse.From(expense.Category),
            expense.Note,
            ExpenseResponse.ReceiptFrom(expense.Receipt),
            expense.AccountId,
            expense.Scheduled,
            expense.RecurringId,
            expense.OriginalAmount,
            expense.OriginalCurrency,
            expense.Rate,
            expense.RateStatus,
            expense.RateDate,
            MemberHomeAmountsResponse.From(expense.Home)
        );
}
