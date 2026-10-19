using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Application;

namespace Penny.Backend.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class OperationsController(ReadinessService readiness) : ControllerBase
{
    [HttpGet("health")]
    public IActionResult Health() => Ok(new { ok = true });

    [HttpGet("ready")]
    public async Task<IActionResult> Ready(CancellationToken cancellationToken)
    {
        var ready = await readiness.IsReadyAsync(cancellationToken);
        return StatusCode(ready ? 200 : 503, new { ok = ready });
    }
}
