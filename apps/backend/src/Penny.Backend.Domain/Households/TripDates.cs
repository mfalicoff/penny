namespace Penny.Backend.Domain.Households;

// A shared trip's travel range. Calendar dates; the end is never before the start.
public sealed record TripDates(DateOnly Start, DateOnly End);
