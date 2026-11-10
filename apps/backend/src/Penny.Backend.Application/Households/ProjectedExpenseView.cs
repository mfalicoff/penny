using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// Legacy `ProjectedExpense`: the viewer's share of a recorded shared expense, or of a
// scheduled occurrence (`Scheduled`; month projections only). `RecurringId` names the
// shared rule on previews and on recorded occurrences the rule recorded (MAZ-139), so
// clients drop a cached preview of the same household, rule and date. Shares stay
// separate from the personal ledger. `AccountId` reaches only the payer.
public sealed record ProjectedExpenseView(
    string Id,
    string HouseholdId,
    string HouseholdName,
    string HouseholdCurrency,
    string Title,
    string Date,
    long TotalCents,
    long ShareCents,
    string PayerUserId,
    ExpenseCategory Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ExpenseReceiptView? Receipt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Scheduled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId
)
{
    // A recorded expense as `viewerId` sees it, with their share (search results use 0
    // for a current member without one). The payer alone sees the account.
    public static ProjectedExpenseView Recorded(
        StoredProjectedExpense row,
        string viewerId,
        long shareCents
    )
    {
        var expense = row.Expense;
        return new(
            expense.Id,
            expense.HouseholdId,
            row.HouseholdName,
            row.HouseholdCurrency,
            expense.Title,
            LedgerDates.Write(expense.Date),
            expense.TotalCents,
            shareCents,
            expense.PayerId,
            expense.Category,
            expense.Note,
            expense.Receipt is { } receipt
                ? ExpenseReceiptView.From(receipt.Id, receipt.Name, receipt.Mime)
                : null,
            string.Equals(viewerId, expense.PayerId, StringComparison.Ordinal)
                ? expense.AccountId
                : null,
            null,
            expense.RecurringId
        );
    }
}
