namespace Penny.Backend.Application.Abstractions.Persistence;

// One membership period, as stored (`household_member_periods`).
public sealed record StoredPeriod(
    string UserId,
    DateTimeOffset JoinedAt,
    DateOnly? JoinedOn,
    DateTimeOffset? LeftAt
);
