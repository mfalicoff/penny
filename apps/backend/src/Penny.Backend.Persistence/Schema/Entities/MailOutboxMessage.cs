namespace Penny.Backend.Persistence.Schema.Entities;

// One outgoing email (MAZ-124), delivered by the mail runner outside the request's
// transaction. Rows hold no address, link or code: the runner reads the recipient
// (the account's email for a password reset, the invite's address for an invitation)
// and issues the code when it sends. `RecipientHash` (SHA-256 of the normalized
// address) and `AccountId` count messages for the rate limits; finished rows are
// purged after a week.
public sealed class MailOutboxMessage
{
    public required string Id { get; set; }
    public required string Kind { get; set; }

    // The account a password reset is for.
    public string? UserId { get; set; }

    // The invitation an invitation email carries.
    public string? EmailInviteId { get; set; }

    // Who caused the message: the account being reset, or the inviter.
    public required string AccountId { get; set; }
    public required string RecipientHash { get; set; }
    public required string Locale { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAt { get; set; }

    // Set once the message is final: sent, failed for good, expired or no longer wanted.
    public DateTimeOffset? FinishedAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public string? LastError { get; set; }
    public string? LeaseOwner { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
