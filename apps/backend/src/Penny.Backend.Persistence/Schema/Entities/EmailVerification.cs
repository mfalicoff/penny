namespace Penny.Backend.Persistence.Schema.Entities;

// An emailed email-verification code (MAZ-172). Keyed by SHA-256(code); the raw code exists
// only in the email. Single use, expiring, one per user, and bound to the address it was
// sent to, so it stops working when the account's email changes.
public sealed class EmailVerification
{
    public required string TokenHash { get; set; }
    public required string UserId { get; set; }
    public required string Email { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
