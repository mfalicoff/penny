using System.Text.Json.Serialization;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// The receipt linked to a shared expense. Audit snapshots leave out `Name`: receipt
// filenames are encrypted at rest and must not be copied into plaintext history.
public sealed record ExpenseReceiptView(
    string Id,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Name,
    string Mime,
    string Uri
)
{
    public static ExpenseReceiptView From(string id, string name, string mime) =>
        new(id, name, mime, ReceiptLink.UriFor(id));
}
