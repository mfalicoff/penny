namespace Penny.Backend.Domain.Households;

// `Trip` is set for a shared trip (POST /api/households/trips), null for a household.
public sealed record NewHousehold(
    string Name,
    string Currency,
    int? TimezoneOffsetMinutes,
    TripDates? Trip
);
