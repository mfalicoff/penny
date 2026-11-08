using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// `Trip` is null for a regular household; `MemberCount` counts open membership periods.
public sealed record StoredHousehold(
    string Id,
    string Name,
    string Currency,
    string CreatorId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ArchivedAt,
    TripDates? Trip,
    int MemberCount
);
