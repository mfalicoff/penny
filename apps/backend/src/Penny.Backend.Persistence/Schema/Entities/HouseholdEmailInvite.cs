namespace Penny.Backend.Persistence.Schema.Entities;

// An invitation sent by email (MAZ-124). One row per household and address: inviting
// the address again resends it. The code is issued when the email is sent, so only its
// SHA-256 is ever stored; a resend issues a new code and the earlier link stops working.
// The code joins once (`JoinedAt`); revoking or archiving sets `RevokedAt`.
public sealed class HouseholdEmailInvite
{
    public required string Id { get; set; }
    public required string HouseholdId { get; set; }
    public required string InvitedBy { get; set; }
    public required string Email { get; set; }
    public string? CodeHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    // The latest request (invite or resend); the list shows it while sending.
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? FailedAt { get; set; }
    public DateTimeOffset? JoinedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
