using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// The legacy `householdView`: `createdAt` is Unix milliseconds and `trip` is present
// only for shared trips. Also the audit payload of household and trip events.
public sealed record HouseholdView(
    string Id,
    string Name,
    string Currency,
    string CreatorId,
    long CreatedAt,
    int MemberCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HouseholdTripView? Trip
)
{
    public static HouseholdView From(StoredHousehold household) =>
        new(
            household.Id,
            household.Name,
            household.Currency,
            household.CreatorId,
            household.CreatedAt.ToUnixTimeMilliseconds(),
            household.MemberCount,
            household.Trip is { } trip
                ? new(LedgerDates.Write(trip.Start), LedgerDates.Write(trip.End))
                : null
        );
}
