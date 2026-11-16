using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Errors;
using Penny.Backend.Api.InboundMail;

namespace Penny.Backend.Api.Middleware;

// CSRF defence: a browser write from an unlisted origin is refused. Native clients
// send no Origin header. Runs before CORS, so preflights from unlisted origins are
// refused too. The Email Worker endpoints (MAZ-184) are not browser routes: they are
// authenticated by an HMAC signature and excluded.
public sealed class OriginPolicyMiddleware(RequestDelegate next, AuthOptions options)
{
    public const string Message = "This origin is not allowed.";

    public Task InvokeAsync(HttpContext context)
    {
        var origin = context.Request.Headers.Origin;
        if (
            !context.Request.Path.StartsWithSegments(
                InboundMailHeaders.Path,
                StringComparison.OrdinalIgnoreCase
            )
            && !HttpMethods.IsGet(context.Request.Method)
            && !string.IsNullOrEmpty(origin.ToString())
            && !options.AllowedOrigins.Contains(origin.ToString(), StringComparer.Ordinal)
        )
            return ApiErrors.WriteAsync(context, 403, Message);
        return next(context);
    }
}
