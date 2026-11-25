using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api")]
// Readiness runs every registered probe in order (PostgreSQL, then receipt storage)
// and reports the first failure.
public sealed class OperationsController(
    IEnumerable<IStorageReadiness> probes,
    LegalOptions legal,
    MailPolicy mail,
    ClientTelemetryOptions telemetry
) : ControllerBase
{
    [HttpGet("health", Name = "getApiHealth")]
    public ActionResult<HealthResponse> Health() => Ok(new HealthResponse(true));

    [HttpGet("info", Name = "getApiInfo")]
    public ActionResult<ServerInfo> Info() =>
        Ok(
            new ServerInfo(
                "penny",
                ServerInfo.CurrentVersion,
                legal.PrivacyPolicyUrl,
                mail.Enabled,
                new ClientTelemetryInfo(
                    telemetry.WebEnabled,
                    telemetry.SessionReplay,
                    telemetry.NativeEnabled
                )
            )
        );

    [HttpGet("ready", Name = "getApiReady")]
    [ProducesResponseType<HealthResponse>(200)]
    [ProducesResponseType<ApiError>(503)]
    public async Task<IActionResult> Ready(CancellationToken cancellationToken)
    {
        StorageStatus? failure = null;
        foreach (var probe in probes)
        {
            var status = await probe.CheckAsync(cancellationToken);
            if (!status.Ready)
            {
                failure = status;
                break;
            }
        }
        if (failure is null)
            return Ok(new HealthResponse(true));
        Response.Headers.RetryAfter = "5";
        var (code, message) = failure.Code switch
        {
            "postgres-version" => (
                ErrorCodes.HealthPostgresVersion,
                "The backend requires PostgreSQL 18."
            ),
            "schema" => (
                ErrorCodes.HealthSchema,
                "Database schema is missing or incompatible. Restart the API to migrate, and check its startup log."
            ),
            "permissions" => (
                ErrorCodes.HealthPermissions,
                "Database user cannot read compatibility metadata. Check its privileges."
            ),
            "search-extensions" => (
                ErrorCodes.HealthSearchExtensions,
                "Database is missing the pg_trgm or vector extension. Create them as administrator."
            ),
            "receipt-storage" => (
                ErrorCodes.HealthReceiptStorage,
                "Receipt storage is not writable. Check the Receipts__Root volume and its permissions."
            ),
            "disk-space" => (
                ErrorCodes.HealthDiskSpace,
                "Receipt storage is low on free disk space. Free space or grow the volume."
            ),
            _ => (
                ErrorCodes.HealthDatabaseUnavailable,
                "Database is unavailable. Check connectivity and configuration."
            ),
        };
        return StatusCode(503, new ApiError(message, code));
    }
}
