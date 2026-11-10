using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Households;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Api.Observability;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Controllers;

// Household and shared-trip membership, invitations and archive (legacy
// server/http/households.ts, MAZ-56). Session-protected by the fallback policy. Shared
// expenses and the projection are in HouseholdExpensesController (MAZ-57), months,
// reimbursements and audit in HouseholdSettlementController (MAZ-58) and recurrence in
// HouseholdRecurringController (MAZ-59). See docs/migration/households.md.
[ApiController]
[Route("api/households")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class HouseholdsController(HouseholdService households) : ControllerBase
{
    [HttpGet(Name = "getApiHouseholds")]
    [ProducesResponseType<HouseholdListResponse>(200)]
    public async Task<ActionResult<HouseholdListResponse>> List(
        CancellationToken cancellationToken
    ) =>
        Ok(
            new HouseholdListResponse([
                .. (await households.ListAsync(User.Session().UserId, cancellationToken)).Select(
                    HouseholdResponse.From
                ),
            ])
        );

    [HttpPost(Name = "postApiHouseholds")]
    [ProducesResponseType<HouseholdEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    public Task<IActionResult> Create(CancellationToken cancellationToken) =>
        CreateAsync(trip: false, cancellationToken);

    [HttpPost("trips", Name = "postApiHouseholdsTrips")]
    [ProducesResponseType<HouseholdEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    public Task<IActionResult> CreateTrip(CancellationToken cancellationToken) =>
        CreateAsync(trip: true, cancellationToken);

    [EnableRateLimiting(InviteRateLimit.Policy)]
    [HttpPost("join", Name = "postApiHouseholdsJoin")]
    [ProducesResponseType<HouseholdEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<HouseholdEnvelopeResponse>> Join(
        CancellationToken cancellationToken
    )
    {
        var joined = await Measured.JoinAsync(async () =>
        {
            using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
            return await households.JoinAsync(
                User.Session().UserId,
                body?.RootElement,
                cancellationToken
            );
        });
        return Ok(Envelope(joined));
    }

    [HttpGet("{id}", Name = "getApiHouseholdsId")]
    [ProducesResponseType<HouseholdDetailResponse>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<HouseholdDetailResponse>> Get(
        string id,
        CancellationToken cancellationToken
    ) =>
        Ok(
            HouseholdDetailResponse.From(
                await households.GetAsync(id, User.Session().UserId, cancellationToken)
            )
        );

    [HttpPatch("{id}", Name = "patchApiHouseholdsId")]
    [ProducesResponseType<HouseholdEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<HouseholdEnvelopeResponse>> Rename(
        string id,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        return Ok(
            Envelope(
                await households.RenameAsync(
                    id,
                    User.Session().UserId,
                    body?.RootElement,
                    cancellationToken
                )
            )
        );
    }

    [HttpPatch("{id}/trip", Name = "patchApiHouseholdsIdTrip")]
    [ProducesResponseType<HouseholdEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<HouseholdEnvelopeResponse>> UpdateTrip(
        string id,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        return Ok(
            Envelope(
                await households.UpdateTripAsync(
                    id,
                    User.Session().UserId,
                    body?.RootElement,
                    cancellationToken
                )
            )
        );
    }

    [HttpPost("{id}/archive", Name = "postApiHouseholdsIdArchive")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<OkResponse>> Archive(
        string id,
        CancellationToken cancellationToken
    )
    {
        await households.ArchiveAsync(id, User.Session().UserId, cancellationToken);
        return Ok(new OkResponse(true));
    }

    [HttpPost("{id}/invites", Name = "postApiHouseholdsIdInvites")]
    [ProducesResponseType<InviteResponse>(201)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<IActionResult> Invite(string id, CancellationToken cancellationToken)
    {
        var invite = await households.InviteAsync(id, User.Session().UserId, cancellationToken);
        return StatusCode(201, new InviteResponse(invite.Code, invite.ExpiresAt));
    }

    [HttpPost("{id}/leave", Name = "postApiHouseholdsIdLeave")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<OkResponse>> Leave(
        string id,
        CancellationToken cancellationToken
    )
    {
        await households.LeaveAsync(id, User.Session().UserId, cancellationToken);
        return Ok(new OkResponse(true));
    }

    [HttpDelete("{id}/members/{userId}", Name = "deleteApiHouseholdsIdMembersUserid")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<OkResponse>> Remove(
        string id,
        string userId,
        CancellationToken cancellationToken
    )
    {
        await households.RemoveAsync(id, User.Session().UserId, userId, cancellationToken);
        return Ok(new OkResponse(true));
    }

    private async Task<IActionResult> CreateAsync(bool trip, CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var created = await households.CreateAsync(
            User.Session().UserId,
            body?.RootElement,
            trip,
            cancellationToken
        );
        return StatusCode(201, Envelope(created));
    }

    private static HouseholdEnvelopeResponse Envelope(HouseholdView household) =>
        new(HouseholdResponse.From(household));
}
