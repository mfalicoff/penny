using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Errors;
using Penny.Backend.Api.InboundMail;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Middleware;

// CSRF defence: a browser write from an unlisted origin is refused. Native clients
// send no Origin header. Runs before CORS, so preflights from unlisted origins are
// refused too. The Email Worker endpoints (MAZ-184) are not browser routes: they are
// authenticated by an HMAC signature and excluded. So is the OIDC callback relay (MAZ-170): Apple posts
// it from its own page, and it only redirects to an allowlisted app address.
public sealed class OriginPolicyMiddleware(RequestDelegate next, AuthOptions options)
{
    public const string Message = "This origin is not allowed.";
    private const string OidcCallbackPath = "/api/auth/oidc/callback";

    public Task InvokeAsync(HttpContext context)
    {
        var origin = context.Request.Headers.Origin;
        if (
            !context.Request.Path.StartsWithSegments(
                InboundMailHeaders.Path,
                StringComparison.OrdinalIgnoreCase
            )
            && !context.Request.Path.StartsWithSegments(
                OidcCallbackPath,
                StringComparison.OrdinalIgnoreCase
            )
            && !HttpMethods.IsGet(context.Request.Method)
            && !string.IsNullOrEmpty(origin.ToString())
            && !options.AllowedOrigins.Contains(origin.ToString(), StringComparer.Ordinal)
        )
            return ApiErrors.WriteAsync(context, 403, ErrorCodes.OriginForbidden, Message);
        return next(context);
    }
}
