using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Persistence.Testing;

namespace Penny.Backend.Api.Testing;

// Controls for browser and simulator runs against a disposable environment (MAZ-62).
// Registered only when TestControlOptions.Enabled (never in Production); every action
// also requires the run's `X-Penny-Test-Token`. Not part of contracts/openapi.json.
[AllowAnonymous]
[ApiController]
[Route("api/test")]
[ApiExplorerSettings(IgnoreApi = true)]
public sealed partial class TestControlsController(
    TestControlOptions options,
    ControllableClock clock,
    FaultRegistry faults,
    AuthService auth,
    TestDataReset reset,
    IHostEnvironment environment
) : ControllerBase
{
    public const string TokenHeader = "X-Penny-Test-Token";
    private static int users;

    [HttpGet("state")]
    public IActionResult State() =>
        Guard()
        ?? Ok(
            new TestStateResponse(
                environment.EnvironmentName,
                clock.GetUtcNow(),
                clock.Pinned is not null,
                faults.Rules
            )
        );

    [HttpPut("clock")]
    public IActionResult SetClock([FromBody] ClockRequest body)
    {
        if (Guard() is { } denied)
            return denied;
        if (body.Now is not { } now)
            return BadRequest(new ApiError("Enter the instant to pin as `now`."));
        clock.Set(now);
        return State();
    }

    [HttpDelete("clock")]
    public IActionResult ResetClock()
    {
        if (Guard() is { } denied)
            return denied;
        clock.Reset();
        return State();
    }

    [HttpPut("faults")]
    public IActionResult SetFaults([FromBody] FaultsRequest body)
    {
        if (Guard() is { } denied)
            return denied;
        var rules = new List<FaultRule>();
        foreach (var rule in body.Rules ?? [])
        {
            var target = rule.Target ?? "http";
            var delay = rule.DelayMs ?? 0;
            if (
                !FaultRule.Targets.Contains(target)
                || delay is < 0 or > FaultRule.MaxDelayMs
                || rule.Status is not (null or (>= 400 and <= 599))
                || rule.Times is < 1
                || (rule.Status is null && rule.Abort != true && delay == 0)
                || (rule.PathPrefix is not null && !rule.PathPrefix.StartsWith('/'))
            )
                return BadRequest(new ApiError("Invalid fault rule."));
            rules.Add(
                new FaultRule(
                    target,
                    rule.Method?.ToUpperInvariant(),
                    rule.PathPrefix,
                    rule.Status,
                    delay,
                    rule.Abort == true,
                    rule.Times
                )
            );
        }
        faults.Replace(rules);
        return State();
    }

    [HttpDelete("faults")]
    public IActionResult ClearFaults()
    {
        if (Guard() is { } denied)
            return denied;
        faults.Clear();
        return State();
    }

    // Registers through the normal password flow, so the account is indistinguishable
    // from a real one. Emails are unique per process and use the reserved `.test` TLD.
    [HttpPost("users")]
    public async Task<IActionResult> CreateUser(
        [FromBody] TestUserRequest? body,
        CancellationToken cancellationToken
    )
    {
        if (Guard() is { } denied)
            return denied;
        var label = body?.Label ?? "user";
        if (!Label().IsMatch(label))
            return BadRequest(
                new ApiError("Use a label of 1–24 lowercase letters, digits or dashes.")
            );
        var number = Interlocked.Increment(ref users).ToString(CultureInfo.InvariantCulture);
        var email =
            $"{label}-{number}-{RandomNumberGenerator.GetHexString(8, lowercase: true)}@penny.test";
        var password = RandomNumberGenerator.GetHexString(24, lowercase: true);
        var session = await auth.RegisterAsync(email, password, cancellationToken);
        var authenticated = await auth.AuthenticateAsync(session.Token, cancellationToken);
        return StatusCode(
            201,
            new TestUserResponse(authenticated!.UserId, session.Email, password, session.Token)
        );
    }

    // Deletes all product data (test databases only), unpins the clock, clears faults.
    [HttpPost("reset")]
    public async Task<IActionResult> Reset(CancellationToken cancellationToken)
    {
        if (Guard() is { } denied)
            return denied;
        var tables = await reset.ResetAsync(options.DatabasePrefix, cancellationToken);
        clock.Reset();
        faults.Clear();
        return Ok(new TestResetResponse(tables));
    }

    private ObjectResult? Guard()
    {
        if (!options.Enabled)
            return NotFound(new ApiError("API route not found."));
        var supplied = Request.Headers[TokenHeader].ToString();
        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(supplied)),
            SHA256.HashData(Encoding.UTF8.GetBytes(options.Token))
        )
            ? null
            : StatusCode(403, new ApiError("Test control token required."));
    }

    [GeneratedRegex("^[a-z0-9-]{1,24}$")]
    private static partial Regex Label();
}
