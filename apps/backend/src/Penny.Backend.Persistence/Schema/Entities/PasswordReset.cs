namespace Penny.Backend.Persistence.Schema.Entities;

// An operator-issued password reset code (MAZ-123). Keyed by SHA-256(code); the raw
// code is delivered to the user out of band. Single use, expiring, one per user.
public sealed class PasswordReset
{
    public required string TokenHash { get; set; }
    public required string UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
