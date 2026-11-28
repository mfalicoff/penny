using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `MemberHomeAmounts` (2.5.0): the viewer's amounts in their home
// currency. `rate`, `rateStatus` and `rateDate` are omitted when it was paid in it.
public sealed record MemberHomeAmountsResponse(
    string Currency,
    long TotalCents,
    long ShareCents,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Rate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateStatus,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RateDate
)
{
    public static MemberHomeAmountsResponse? From(MemberHomeView? home) =>
        home is null
            ? null
            : new(
                home.Currency,
                home.TotalCents,
                home.ShareCents,
                home.Rate,
                home.RateStatus,
                home.RateDate
            );
}
