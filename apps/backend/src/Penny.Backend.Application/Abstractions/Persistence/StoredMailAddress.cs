namespace Penny.Backend.Application.Abstractions.Persistence;

// A live receipt address with its full text opened (MAZ-184).
public sealed record StoredMailAddress(
    string Id,
    string Address,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? LastReceivedAt,
    IReadOnlyList<string> AllowedSenders
);
