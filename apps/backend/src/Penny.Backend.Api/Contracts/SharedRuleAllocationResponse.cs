using System.Text.Json.Serialization;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Api.Contracts;

// One rule allocation: `{userId, amountCents}` for exact rules or
// `{userId, percentBasisPoints}` for percentage rules.
public sealed record SharedRuleAllocationResponse(
    string UserId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? AmountCents,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? PercentBasisPoints
)
{
    public static SharedRuleAllocationResponse From(SplitAllocation allocation) =>
        new(allocation.UserId, allocation.AmountCents, allocation.PercentBasisPoints);
}
