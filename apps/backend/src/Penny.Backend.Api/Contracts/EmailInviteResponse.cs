using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `EmailInvite` (MAZ-124). Times are Unix milliseconds.
public sealed record EmailInviteResponse(
    string Id,
    string Email,
    string Status,
    long CreatedAt,
    long? SentAt,
    long? ExpiresAt
)
{
    public static EmailInviteResponse From(EmailInviteView view) =>
        new(view.Id, view.Email, view.Status, view.CreatedAt, view.SentAt, view.ExpiresAt);
}
