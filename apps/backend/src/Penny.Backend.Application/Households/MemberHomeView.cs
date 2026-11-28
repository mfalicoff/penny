using System.Text.Json.Serialization;

namespace Penny.Backend.Application.Households;

// Contract schema `MemberHomeAmounts` (2.6.0): the viewer's amounts of a shared expense in
// their home (ledger) currency. `Rate` (home units per unit of what was paid), its status
// and publication are absent when it was paid in the home currency.
public sealed record MemberHomeView(
    string Currency,
    long TotalCents,
    long ShareCents,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Rate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateStatus,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateDate
);
