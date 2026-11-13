using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Observability;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Controllers;

// OIDC sign-in routes. OidcService is registered only when OIDC is
// configured; otherwise start/complete return 404 after the body is parsed.
[ApiController]
[Route("api/auth/oidc")]
[AllowAnonymous]
[ProducesResponseType<ApiError>(500)]
public sealed class OidcController(
    AuthOptions options,
    TimeProvider clock,
    OidcService? oidc = null
) : ControllerBase
{
    private static readonly string[] StartFields = ["redirectUri"];
    private static readonly string[] CompleteFields = ["transaction", "callbackUrl"];

    [HttpGet(Name = "getApiAuthOidc")]
    [ProducesResponseType<OidcConfigResponse>(200)]
    public ActionResult<OidcConfigResponse> Config() =>
        Ok(new OidcConfigResponse(oidc is not null, oidc?.Label));

    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("start", Name = "postApiAuthOidcStart")]
    [ProducesResponseType<OidcChallengeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<OidcChallengeResponse>> Start(
        CancellationToken cancellationToken
    )
    {
        var fields = await JsonStringFields.ReadAsync(Request, StartFields, cancellationToken);
        var challenge = await Configured().StartAsync(fields[0], cancellationToken);
        return Ok(
            new OidcChallengeResponse(
                challenge.Transaction,
                challenge.AuthorizationUrl,
                challenge.ExpiresAt
            )
        );
    }

    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("complete", Name = "postApiAuthOidcComplete")]
    [ProducesResponseType<SessionResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<SessionResponse>> Complete(CancellationToken cancellationToken)
    {
        var session = await Measured.SignInAsync(
            Measured.Oidc,
            async () =>
            {
                var fields = await JsonStringFields.ReadAsync(
                    Request,
                    CompleteFields,
                    cancellationToken
                );
                return await Configured().CompleteAsync(fields[0], fields[1], cancellationToken);
            }
        );
        SessionCookie.Append(Response, session.Token, options.SecureCookies, clock);
        return Ok(new SessionResponse(session.Token, session.Email));
    }

    private OidcService Configured() =>
        oidc ?? throw new BackendFailure(FailureKind.NotFound, OidcService.NotConfigured);
}
