using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Households;

// The legacy reimbursement view (src/data/households.ts `HouseholdReimbursement`), also
// the audit payload of `reimbursement.created`. `CreatedAt` is Unix milliseconds;
// `ExpenseId` is present only for an individual expense payment.
public sealed record ReimbursementView(
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
    public static ReimbursementView From(StoredReimbursement reimbursement) =>
        new(
            reimbursement.Id,
            reimbursement.HouseholdId,
            reimbursement.Month,
            reimbursement.FromUserId,
            reimbursement.ToUserId,
            reimbursement.AmountCents,
            reimbursement.CreatedBy,
            reimbursement.CreatedAt.ToUnixTimeMilliseconds(),
            reimbursement.ExpenseId
        );
}
