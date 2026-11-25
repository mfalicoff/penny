using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Primitives;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Observability;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Controllers;

// OIDC sign-in routes, for each configured provider (MAZ-170). OidcService is registered
// only when a provider is configured; otherwise the sign-in routes return 404 after the
// body is parsed.
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
    private static readonly string[] StartFields = ["redirectUri", "provider"];
    private static readonly string[] CompleteFields = ["transaction", "callbackUrl"];
    private static readonly string[] NativeStartFields = ["provider"];
    private static readonly string[] NativeCompleteFields =
    [
        "transaction",
        "idToken",
        "givenName",
        "familyName",
    ];

    [HttpGet(Name = "getApiAuthOidc")]
    [ProducesResponseType<OidcConfigResponse>(200)]
    public ActionResult<OidcConfigResponse> Config() =>
        Ok(
            new OidcConfigResponse(
                oidc is not null,
                oidc?.Providers[0].Label,
                oidc is null
                    ? []
                    :
                    [
                        .. oidc.Providers.Select(provider => new OidcProviderResponse(
                            provider.Id,
                            provider.Label,
                            provider.Icon,
                            provider.Native
                        )),
                    ]
            )
        );

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
        var challenge = await Configured().StartAsync(fields[1], fields[0], cancellationToken);
        return Ok(
            new OidcChallengeResponse(
                challenge.Transaction,
                challenge.AuthorizationUrl,
                challenge.ExpiresAt
            )
        );
    }

    // The provider's own redirect for providers configured with a CallbackUri: Apple posts
    // its response here (form_post); others redirect here with a query. The response goes
    // on, unchanged, to the app redirect its attempt was started for. Exempt from the
    // origin policy: the post comes from the provider's page and changes nothing.
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpGet("callback/{provider}", Name = "getApiAuthOidcCallback")]
    [HttpPost("callback/{provider}", Name = "postApiAuthOidcCallback")]
    [ProducesResponseType(303)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Callback(string provider, CancellationToken cancellationToken)
    {
        IEnumerable<KeyValuePair<string, StringValues>> received = HttpMethods.IsPost(
            Request.Method
        )
            ? Request.HasFormContentType
                ? await Request.ReadFormAsync(cancellationToken)
                : throw new BackendFailure(FailureKind.Invalid, OidcService.InvalidResponse)
            : Request.Query;
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, values) in received)
        {
            // Protocol parameters must not repeat.
            if (values.Count != 1)
                throw new BackendFailure(FailureKind.Invalid, OidcService.InvalidResponse);
            parameters[name] = values[0] ?? "";
        }
        var target = await Configured().RelayAsync(provider, parameters, cancellationToken);
        Response.Headers.Location = target;
        return StatusCode(303);
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
        var session = await Measured.SignInAsync(Measured.Oidc, async () =>
        {
            var fields = await JsonStringFields.ReadAsync(
                Request,
                CompleteFields,
                cancellationToken
            );
            return await Configured().CompleteAsync(fields[0], fields[1], cancellationToken);
        });
        SessionCookie.Append(Response, session.Token, options.SecureCookies, clock);
        return Ok(new SessionResponse(session.Token, session.Email));
    }

    // Native sign-in (MAZ-170): the app asks for a nonce, signs in with the platform (Sign in
    // with Apple on iOS) and sends the ID token it got.
    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("native/start", Name = "postApiAuthOidcNativeStart")]
    [ProducesResponseType<OidcNativeChallengeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<OidcNativeChallengeResponse>> NativeStart(
        CancellationToken cancellationToken
    )
    {
        var fields = await JsonStringFields.ReadAsync(
            Request,
            NativeStartFields,
            cancellationToken
        );
        var challenge = await Configured().StartNativeAsync(fields[0], cancellationToken);
        return Ok(
            new OidcNativeChallengeResponse(
                challenge.Transaction,
                challenge.Nonce,
                challenge.ExpiresAt
            )
        );
    }

    [EnableRateLimiting(AuthRateLimit.Policy)]
    [HttpPost("native/complete", Name = "postApiAuthOidcNativeComplete")]
    [ProducesResponseType<SessionResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<SessionResponse>> NativeComplete(
        CancellationToken cancellationToken
    )
    {
        var session = await Measured.SignInAsync(Measured.Oidc, async () =>
        {
            var fields = await JsonStringFields.ReadAsync(
                Request,
                NativeCompleteFields,
                cancellationToken
            );
            return await Configured()
                .CompleteNativeAsync(fields[0], fields[1], fields[2], fields[3], cancellationToken);
        });
        SessionCookie.Append(Response, session.Token, options.SecureCookies, clock);
        return Ok(new SessionResponse(session.Token, session.Email));
    }

    private OidcService Configured() =>
        oidc ?? throw new BackendFailure(FailureKind.NotFound, OidcService.NotConfigured);
}
