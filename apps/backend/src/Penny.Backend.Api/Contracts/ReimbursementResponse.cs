using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Reimbursement`; `expenseId` only for an individual expense payment.
public sealed record ReimbursementResponse(
    string Id,
    string HouseholdId,
    string Month,
    string FromUserId,
    string ToUserId,
    long AmountCents,
    string CreatedBy,
    long CreatedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ExpenseId
)
{
    public static ReimbursementResponse From(ReimbursementView reimbursement) =>
        new(
            reimbursement.Id,
            reimbursement.HouseholdId,
            reimbursement.Month,
            reimbursement.FromUserId,
            reimbursement.ToUserId,
            reimbursement.AmountCents,
            reimbursement.CreatedBy,
            reimbursement.CreatedAt,
            reimbursement.ExpenseId
        );
}
