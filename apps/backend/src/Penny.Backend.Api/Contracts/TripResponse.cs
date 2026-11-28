using System.Text.Json.Serialization;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

public sealed record TripResponse(
    string Id,
    string Name,
    string StartDate,
    string EndDate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        string? SharedHouseholdId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Currency
)
{
    public static TripResponse From(Trip trip) =>
        new(
            trip.Id,
            trip.Name,
            LedgerDates.Write(trip.StartDate),
            LedgerDates.Write(trip.EndDate),
            trip.SharedHouseholdId,
            trip.Currency
        );
}
