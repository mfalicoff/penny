using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Controllers;

// Month recaps, monthly reimbursements and audit history (legacy
// server/http/households.ts, MAZ-58). Session-protected by the fallback policy. See
// docs/migration/settlement.md.
[ApiController]
[Route("api/households")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class HouseholdSettlementController(SettlementService settlement) : ControllerBase
{
    [HttpGet("{id}/months/{month}", Name = "getApiHouseholdsIdMonthsMonth")]
    [ProducesResponseType<MonthRecapResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<MonthRecapResponse>> Month(
        string id,
        string month,
        CancellationToken cancellationToken
    ) =>
        Ok(
            MonthRecapResponse.From(
                await settlement.MonthAsync(id, User.Session().UserId, month, cancellationToken)
            )
        );

    [HttpPost(
        "{id}/months/{month}/reimbursements",
        Name = "postApiHouseholdsIdMonthsMonthReimbursements"
    )]
    [ProducesResponseType<ReimbursementEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<IActionResult> Reimburse(
        string id,
        string month,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var recorded = await settlement.ReimburseAsync(
            id,
            User.Session().UserId,
            month,
            body?.RootElement,
            cancellationToken
        );
        return StatusCode(
            201,
            new ReimbursementEnvelopeResponse(ReimbursementResponse.From(recorded))
        );
    }

    [HttpGet("{id}/audit", Name = "getApiHouseholdsIdAudit")]
    [ProducesResponseType<AuditListResponse>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<AuditListResponse>> Audit(
        string id,
        CancellationToken cancellationToken
    ) =>
        Ok(
            new AuditListResponse([
                .. (
                    await settlement.AuditAsync(
                        id,
                        User.Session().UserId,
                        Query("expenseId"),
                        cancellationToken
                    )
                ).Select(AuditEventResponse.From),
            ])
        );

    // Express `typeof req.query.x === "string"` followed by a truthiness check: one
    // non-empty value, else absent.
    private string? Query(string name) =>
        Request.Query.TryGetValue(name, out var values)
        && values.Count == 1
        && !string.IsNullOrEmpty(values[0])
            ? values[0]
            : null;
}
