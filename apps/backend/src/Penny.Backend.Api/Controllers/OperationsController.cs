using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Api.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api")]
public sealed class OperationsController(IStorageReadiness readiness) : ControllerBase
{
    [HttpGet("health", Name = "getApiHealth")]
    public ActionResult<HealthResponse> Health() => Ok(new HealthResponse(true));

    [HttpGet("info", Name = "getApiInfo")]
    public ActionResult<ServerInfo> Info() => Ok(new ServerInfo("penny", "1.0.0"));

    [HttpGet("ready", Name = "getApiReady")]
    [ProducesResponseType<HealthResponse>(200)]
    [ProducesResponseType<ApiError>(503)]
    public async Task<IActionResult> Ready(CancellationToken cancellationToken)
    {
        var status = await readiness.CheckAsync(cancellationToken);
        if (status.Ready)
            return Ok(new HealthResponse(true));
        Response.Headers.RetryAfter = "5";
        return StatusCode(
            503,
            new ApiError(
                status.Code switch
                {
                    "postgres-version" => "The backend requires PostgreSQL 18.",
                    "schema" =>
                        "Database schema is missing or incompatible. Run the explicit migration command.",
                    "import" =>
                        "SQLite import is incomplete. Resume and verify the sealed snapshot before serving traffic.",
                    "runtime-role" =>
                        "Use a restricted runtime database role without schema creation privileges.",
                    "permissions" =>
                        "Runtime database role cannot read compatibility metadata. Check its grants.",
                    _ => "Database is unavailable. Check connectivity and configuration.",
                }
            )
        );
    }
}
