using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ExpensePayer` (MAZ-275): who paid a projected expense. `displayName` is
// omitted when the payer has none (clients show the email); `deleted` is true, and
// otherwise omitted, when the person deleted their account (clients show "Former member").
public sealed record ExpensePayerResponse(
    string Email,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Deleted
)
{
    public static ExpensePayerResponse From(ExpensePayerView payer) =>
        new(payer.Email, payer.DisplayName, payer.Deleted);
}
