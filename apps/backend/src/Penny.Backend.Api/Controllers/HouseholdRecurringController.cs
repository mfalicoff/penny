using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Controllers;

// Shared recurring rules (MAZ-59). Session-protected
// by the fallback policy. Occurrences are recorded by SharedRecurrenceWorker; see
// docs/reference/shared-recurrence.md.
[ApiController]
[Route("api/households/{id}/recurring")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class HouseholdRecurringController(SharedRecurrenceService rules) : ControllerBase
{
    [HttpGet(Name = "getApiHouseholdsIdRecurring")]
    [ProducesResponseType<SharedRuleListResponse>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<SharedRuleListResponse>> List(
        string id,
        CancellationToken cancellationToken
    ) =>
        Ok(
            new SharedRuleListResponse([
                .. (await rules.ListAsync(id, User.Session().UserId, cancellationToken)).Select(
                    SharedRuleResponse.From
                ),
            ])
        );

    [HttpPost(Name = "postApiHouseholdsIdRecurring")]
    [ProducesResponseType<SharedRuleEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<IActionResult> Create(string id, CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var created = await rules.CreateAsync(
            id,
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        return StatusCode(201, new SharedRuleEnvelopeResponse(SharedRuleResponse.From(created)));
    }

    [HttpPut("{ruleId}", Name = "putApiHouseholdsIdRecurringRuleid")]
    [ProducesResponseType<SharedRuleEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<SharedRuleEnvelopeResponse>> Update(
        string id,
        string ruleId,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        return Ok(
            new SharedRuleEnvelopeResponse(
                SharedRuleResponse.From(
                    await rules.UpdateAsync(
                        id,
                        User.Session().UserId,
                        ruleId,
                        body?.RootElement,
                        cancellationToken
                    )
                )
            )
        );
    }

    // The revision travels in the DELETE body.
    [HttpDelete("{ruleId}", Name = "deleteApiHouseholdsIdRecurringRuleid")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<OkResponse>> Delete(
        string id,
        string ruleId,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        await rules.DeleteAsync(
            id,
            User.Session().UserId,
            ruleId,
            body?.RootElement,
            cancellationToken
        );
        return Ok(new OkResponse(true));
    }
}
