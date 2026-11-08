using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.Controllers;

[ApiController]
[Route("api/auth")]
[ProducesResponseType<ApiError>(500)]
public sealed class AuthController(
    AuthService auth,
    PasswordResetService resets,
    AuthOptions options,
    TimeProvider clock
) : ControllerBase
{
    private static readonly string[] ResetFields = ["token", "password"];

    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("register", Name = "postApiAuthRegister")]
    [ProducesResponseType<SessionResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Register(CancellationToken cancellationToken)
    {
        var (email, password) = await CredentialsBody.ReadAsync(Request, cancellationToken);
        var session = await auth.RegisterAsync(email, password, cancellationToken);
        SessionCookie.Append(Response, session.Token, options.SecureCookies, clock);
        return StatusCode(201, new SessionResponse(session.Token, session.Email));
    }

    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("login", Name = "postApiAuthLogin")]
    [ProducesResponseType<SessionResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Login(CancellationToken cancellationToken)
    {
        var (email, password) = await CredentialsBody.ReadAsync(Request, cancellationToken);
        var session = await auth.LoginAsync(email, password, cancellationToken);
        SessionCookie.Append(Response, session.Token, options.SecureCookies, clock);
        return Ok(new SessionResponse(session.Token, session.Email));
    }

    // MAZ-123, .NET only: redeems an operator-issued reset code. Every session of the
    // account is revoked and no new one is issued; the user then signs in normally.
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("password-reset", Name = "postApiAuthPasswordReset")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<OkResponse>> ResetPassword(CancellationToken cancellationToken)
    {
        var fields = await JsonStringFields.ReadAsync(Request, ResetFields, cancellationToken);
        await resets.CompleteAsync(fields[0], fields[1], cancellationToken);
        return Ok(new OkResponse(true));
    }

    [HttpGet("me", Name = "getApiAuthMe")]
    [ProducesResponseType<MeResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken cancellationToken) =>
        Ok(new MeResponse(await auth.EmailAsync(User.Session().UserId, cancellationToken)));

    [HttpPost("logout", Name = "postApiAuthLogout")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    public async Task<ActionResult<OkResponse>> Logout(CancellationToken cancellationToken)
    {
        await auth.LogoutAsync(User.Session().TokenHash, cancellationToken);
        SessionCookie.Clear(Response, options.SecureCookies);
        return Ok(new OkResponse(true));
    }
}
