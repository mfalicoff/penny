using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Api.Observability;
using Penny.Backend.Application.Ledgers;

namespace Penny.Backend.Api.Controllers;

// Personal ledger sync (legacy server/http/ledger.ts). Session-protected by the
// fallback policy; every query is scoped to the session's user.
[ApiController]
[Route("api/ledger")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class LedgerController(LedgerService ledgers) : ControllerBase
{
    [HttpGet(Name = "getApiLedger")]
    [ProducesResponseType<LedgerSnapshotResponse>(200)]
    public async Task<ActionResult<LedgerSnapshotResponse>> Read(
        CancellationToken cancellationToken
    ) =>
        Ok(
            LedgerSnapshotResponse.From(
                await ledgers.ReadAsync(User.Session().UserId, cancellationToken)
            )
        );

    // The body is the whole `{revision, ledger}` snapshot; see docs/migration/ledger.md.
    [HttpPut(Name = "putApiLedger")]
    [ProducesResponseType<LedgerSnapshotResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<LedgerSnapshotResponse>> Save(
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var saved = await Measured.LedgerSaveAsync(() =>
            ledgers.SaveAsync(User.Session().UserId, body?.RootElement, cancellationToken)
        );
        return Ok(LedgerSnapshotResponse.From(saved));
    }
}
