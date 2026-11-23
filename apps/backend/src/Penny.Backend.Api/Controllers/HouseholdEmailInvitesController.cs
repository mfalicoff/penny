using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Mail;

namespace Penny.Backend.Api.Controllers;

// Invitations by email (MAZ-124): list, invite, resend and revoke, for the household's
// creator. Every route answers 404 `This server doesn't send email.` while email is off.
// See docs/reference/households.md#invitations-by-email.
[ApiController]
[Route("api/households/{id}/email-invites")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class HouseholdEmailInvitesController(EmailInviteService invites) : ControllerBase
{
    private static readonly string[] InviteFields = ["email"];

    [HttpGet(Name = "getApiHouseholdsIdEmailInvites")]
    [ProducesResponseType<EmailInviteListResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<EmailInviteListResponse>> List(
        string id,
        CancellationToken cancellationToken
    ) =>
        Ok(
            new EmailInviteListResponse([
                .. (await invites.ListAsync(id, User.Session().UserId, cancellationToken)).Select(
                    EmailInviteResponse.From
                ),
            ])
        );

    [HttpPost(Name = "postApiHouseholdsIdEmailInvites")]
    [ProducesResponseType<EmailInviteResponse>(202)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Invite(string id, CancellationToken cancellationToken)
    {
        var fields = await JsonStringFields.ReadAsync(Request, InviteFields, cancellationToken);
        var invite = await invites.InviteAsync(
            id,
            User.Session().UserId,
            fields[0],
            MailLocales.From(Request.Headers.AcceptLanguage),
            cancellationToken
        );
        return StatusCode(202, EmailInviteResponse.From(invite));
    }

    [HttpPost("{inviteId}/resend", Name = "postApiHouseholdsIdEmailInvitesInviteIdResend")]
    [ProducesResponseType<EmailInviteResponse>(202)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Resend(
        string id,
        string inviteId,
        CancellationToken cancellationToken
    )
    {
        var invite = await invites.ResendAsync(
            id,
            User.Session().UserId,
            inviteId,
            MailLocales.From(Request.Headers.AcceptLanguage),
            cancellationToken
        );
        return StatusCode(202, EmailInviteResponse.From(invite));
    }

    [HttpDelete("{inviteId}", Name = "deleteApiHouseholdsIdEmailInvitesInviteId")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<OkResponse>> Revoke(
        string id,
        string inviteId,
        CancellationToken cancellationToken
    )
    {
        await invites.RevokeAsync(id, User.Session().UserId, inviteId, cancellationToken);
        return Ok(new OkResponse(true));
    }
}
