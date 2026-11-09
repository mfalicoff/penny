using System.Text.Json.Serialization;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// Legacy `ProjectedExpense`: the viewer's share of a recorded shared expense, or of a
// scheduled occurrence (`Scheduled`, `RecurringId`; month projections only). Shares
// stay separate from the personal ledger. `AccountId` reaches only the payer.
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
);
