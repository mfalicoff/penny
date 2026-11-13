using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Controllers;

// Push device registration (legacy server/http/push.ts, MAZ-61). Session-protected by
// the fallback policy; a registration belongs to the presenting session, and logout
// or session expiry removes it. See docs/migration/push.md.
[ApiController]
[Route("api/push/devices")]
[ProducesResponseType<ApiError>(400)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
[ProducesResponseType<ApiError>(413)]
[ProducesResponseType<ApiError>(500)]
public sealed class PushDevicesController(PushDeviceService devices) : ControllerBase
{
    [HttpPost(Name = "postApiPushDevices")]
    [ProducesResponseType<OkResponse>(201)]
    public async Task<IActionResult> Register(CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        await devices.RegisterAsync(User.Session(), body?.RootElement, cancellationToken);
        return StatusCode(201, new OkResponse(true));
    }

    [HttpDelete(Name = "deleteApiPushDevices")]
    [ProducesResponseType<OkResponse>(200)]
    public async Task<ActionResult<OkResponse>> Remove(CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        await devices.RemoveAsync(User.Session(), body?.RootElement, cancellationToken);
        return Ok(new OkResponse(true));
    }
}
