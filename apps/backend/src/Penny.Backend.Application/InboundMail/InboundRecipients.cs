namespace Penny.Backend.Application.InboundMail;

// The recipient list the Email Worker caches (MAZ-184): SHA-256 hex of each live local
// part, sorted, and a version that changes whenever the list does. No user ids, counts
// per user or expiry dates.
public sealed record InboundRecipients(
    string Version,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<string> Hashes
);
