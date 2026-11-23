using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Observability;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Controllers;

[ApiController]
[Route("api/auth")]
[ProducesResponseType<ApiError>(500)]
public sealed class AuthController(
    AuthService auth,
    ProfileService profiles,
    PasswordResetService resets,
    PasswordResetMailService resetMail,
    AuthOptions options,
    TimeProvider clock
) : ControllerBase
{
    private static readonly string[] ResetFields = ["token", "password"];
    private static readonly string[] ResetRequestFields = ["email"];
    private static readonly string[] RegisterFields = ["email", "password", "displayName"];
    private static readonly string[] ChangeFields = ["currentPassword", "newPassword"];

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
        var session = await Measured.SignInAsync(Measured.Registration, async () =>
        {
            // `displayName` is optional (MAZ-171); older apps send only the credentials.
            var fields = await JsonStringFields.ReadAsync(
                Request,
                RegisterFields,
                cancellationToken
            );
            return await auth.RegisterAsync(fields[0], fields[1], fields[2], cancellationToken);
        });
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
        var session = await Measured.SignInAsync(Measured.Password, async () =>
        {
            var (email, password) = await CredentialsBody.ReadAsync(Request, cancellationToken);
            return await auth.LoginAsync(email, password, cancellationToken);
        });
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

    // MAZ-124: asks for a reset by email. The answer is the same whether or not the
    // address has an account, and whether or not an email is queued (an earlier one still
    // waiting, or the daily limits); the emailed code is redeemed with POST
    // /api/auth/password-reset. 404 while the server sends no email.
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("password-reset/request", Name = "postApiAuthPasswordResetRequest")]
    [ProducesResponseType<OkResponse>(202)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> RequestPasswordReset(CancellationToken cancellationToken)
    {
        var fields = await JsonStringFields.ReadAsync(
            Request,
            ResetRequestFields,
            cancellationToken
        );
        await resetMail.RequestAsync(
            fields[0],
            MailLocales.From(Request.Headers.AcceptLanguage),
            cancellationToken
        );
        return StatusCode(202, new OkResponse(true));
    }

    // MAZ-171: a signed-in password change. Rate-limited like sign-in; the other sessions end
    // and this one (and its cookie) stays.
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("password", Name = "postApiAuthPassword")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<OkResponse>> ChangePassword(CancellationToken cancellationToken)
    {
        var fields = await JsonStringFields.ReadAsync(Request, ChangeFields, cancellationToken);
        await auth.ChangePasswordAsync(User.Session(), fields[0], fields[1], cancellationToken);
        return Ok(new OkResponse(true));
    }

    [HttpGet("me", Name = "getApiAuthMe")]
    [ProducesResponseType<MeResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken cancellationToken) =>
        Ok(MeResponse.From(await profiles.GetAsync(User.Session().UserId, cancellationToken)));

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
