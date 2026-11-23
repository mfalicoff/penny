namespace Penny.Backend.Application.Mail;

// An outbox message leased to one runner. It holds no address or code.
public sealed record MailClaim(
    string Id,
    string Kind,
    string? UserId,
    string? EmailInviteId,
    string Locale,
    DateTimeOffset CreatedAt,
    int Attempts
);
