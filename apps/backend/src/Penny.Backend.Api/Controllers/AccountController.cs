using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Exports;
using Penny.Backend.Application.Accounts;

namespace Penny.Backend.Api.Controllers;

// The person's whole account (MAZ-152): the full export, the entries CSV and deleting the
// account. Session-protected by the fallback policy; everything is scoped to the session's
// user.
[ApiController]
[Route("api")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class AccountController(
    AccountDeletionService deletion,
    AccountExport export,
    AuthOptions options,
    TimeProvider clock
) : ControllerBase
{
    private static readonly string[] DeleteFields = ["password"];

    // One ZIP with everything that belongs to the person. Receipts make it large, so the
    // request has no timeout.
    [DisableRequestTimeout]
    [HttpGet("export", Name = "getApiExport")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Export(CancellationToken cancellationToken)
    {
        var zip = await export.WriteAsync(User.Session().UserId, cancellationToken);
        Response.Headers.CacheControl = "no-store";
        return File(zip, "application/zip", export.FileName());
    }

    // Entries as CSV for a month (`month` YYYY-MM), a year (`year` YYYY) or everything.
    [HttpGet("export/entries", Name = "getApiExportEntries")]
    [ProducesResponseType(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<IActionResult> Entries(CancellationToken cancellationToken)
    {
        var month = Query("month");
        var year = month is null ? Query("year") : null;
        var csv = await export.EntriesAsync(User.Session().UserId, month, year, cancellationToken);
        Response.Headers.CacheControl = "no-store";
        return File(
            System.Text.Encoding.UTF8.GetBytes(csv),
            "text/csv; charset=utf-8",
            AccountExport.EntriesFileName(month ?? year, clock.GetUtcNow())
        );
    }

    // Deletes the account after checking its password (a provider account sends none),
    // and signs out every device, this one included. Rate-limited like sign-in.
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("account/delete", Name = "postApiAccountDelete")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<OkResponse>> Delete(CancellationToken cancellationToken)
    {
        var fields = await JsonStringFields.ReadAsync(Request, DeleteFields, cancellationToken);
        await deletion.DeleteAsync(User.Session(), fields[0], cancellationToken);
        SessionCookie.Clear(Response, options.SecureCookies);
        return Ok(new OkResponse(true));
    }

    private string? Query(string name) =>
        Request.Query.TryGetValue(name, out var values)
        && values.Count == 1
        && !string.IsNullOrEmpty(values[0])
            ? values[0]
            : null;
}
