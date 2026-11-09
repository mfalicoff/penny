using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// The legacy shared rule view (src/data/households.ts `HouseholdRecurring`), also the
// audit payload of rule events. `Allocations` is absent for equal rules; `AccountId`
// is the payer's private account, present only when the viewer is the payer and
// never in audit.
public sealed record SharedRuleView(
    string Id,
    string HouseholdId,
    string Title,
    long TotalCents,
    string PayerUserId,
    string SplitMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        IReadOnlyList<SplitAllocation>? Allocations,
    ExpenseCategory Category,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReceiptId,
    string Frequency,
    string NextDate,
    int AnchorDay,
    bool Active,
    long Revision
)
{
    public static SharedRuleView From(StoredRule rule, string viewerId)
    {
        var values = rule.Values;
        return new(
            rule.Id,
            rule.HouseholdId,
            values.Title,
            values.TotalCents,
            values.PayerId,
            values.SplitMode,
            values.Allocations.Count == 0 ? null : values.Allocations,
            values.Category,
            values.Note,
            string.Equals(viewerId, values.PayerId, StringComparison.Ordinal)
                ? values.AccountId
                : null,
            values.ReceiptId,
            values.Frequency,
            LedgerDates.Write(values.NextDate),
            values.AnchorDay,
            values.Active,
            rule.Revision
        );
    }

    // Legacy audit payloads drop the payer's account (`{...rule, accountId: undefined}`).
    public SharedRuleView ForAudit() => this with { AccountId = null };
}
