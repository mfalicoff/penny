using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Households;

// Who paid a projected expense, as the household's members see them: the display name
// (MAZ-171; omitted when they have none, so clients show the email) and the email.
// `Deleted` (MAZ-152) is true, and otherwise omitted, when the person deleted their
// account: clients show "Former member" and no name or email.
public sealed record ExpensePayerView(
    string Email,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Deleted
)
{
    public static ExpensePayerView From(StoredPayer payer) =>
        new(payer.Email, payer.Deleted ? null : payer.DisplayName, payer.Deleted ? true : null);
}
