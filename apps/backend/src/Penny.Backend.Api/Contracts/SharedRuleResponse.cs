using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `SharedRecurring`. Optional fields are
// omitted when absent; `accountId` is present only for the payer.
public sealed record SharedRuleResponse(
    string Id,
    string HouseholdId,
    string Title,
    long TotalCents,
    string PayerUserId,
    string SplitMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        IReadOnlyList<SharedRuleAllocationResponse>? Allocations,
    ExpenseCategoryResponse Category,
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
    public static SharedRuleResponse From(SharedRuleView rule) =>
        new(
            rule.Id,
            rule.HouseholdId,
            rule.Title,
            rule.TotalCents,
            rule.PayerUserId,
            rule.SplitMode,
            rule.Allocations is { } allocations
                ? [.. allocations.Select(SharedRuleAllocationResponse.From)]
                : null,
            ExpenseCategoryResponse.From(rule.Category),
            rule.Note,
            rule.AccountId,
            rule.ReceiptId,
            rule.Frequency,
            rule.NextDate,
            rule.AnchorDay,
            rule.Active,
            rule.Revision
        );
}
