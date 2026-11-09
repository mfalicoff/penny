using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Household`; `trip` is omitted for regular households.
public sealed record HouseholdResponse(
    string Id,
    string Name,
    string Currency,
    string CreatorId,
    long CreatedAt,
    int MemberCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        HouseholdTripResponse? Trip
)
{
    public static HouseholdResponse From(HouseholdView household) =>
        new(
            household.Id,
            household.Name,
            household.Currency,
            household.CreatorId,
            household.CreatedAt,
            household.MemberCount,
            household.Trip is { } trip ? new(trip.StartDate, trip.EndDate) : null
        );
}
