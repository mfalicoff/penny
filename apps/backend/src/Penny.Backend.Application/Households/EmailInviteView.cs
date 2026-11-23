using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Households;

// Contract schema `EmailInvite`. Times are Unix milliseconds. Status:
// `sending` (queued, or a resend not yet sent), `waiting` (sent, unused, unexpired),
// `expired`, `joined` or `failed` (the mail server refused it for good).
public sealed record EmailInviteView(
    string Id,
    string Email,
    string Status,
    long CreatedAt,
    long? SentAt,
    long? ExpiresAt
)
{
    public static EmailInviteView From(StoredEmailInvite invite, DateTimeOffset now) =>
        new(
            invite.Id,
            invite.Email,
            StatusOf(invite, now),
            invite.CreatedAt.ToUnixTimeMilliseconds(),
            invite.SentAt?.ToUnixTimeMilliseconds(),
            invite.ExpiresAt?.ToUnixTimeMilliseconds()
        );

    public static string StatusOf(StoredEmailInvite invite, DateTimeOffset now) =>
        invite.JoinedAt is not null ? "joined"
        : invite.FailedAt is not null ? "failed"
        : invite.SentAt is null || invite.SentAt < invite.RequestedAt ? "sending"
        : invite.ExpiresAt is null || invite.ExpiresAt <= now ? "expired"
        : "waiting";
}
