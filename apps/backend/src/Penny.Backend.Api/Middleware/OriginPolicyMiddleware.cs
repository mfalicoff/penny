using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Errors;

namespace Penny.Backend.Api.Middleware;

// Legacy CSRF defence: a browser write from an unlisted origin is refused. Native
// clients send no Origin header. Runs before CORS, so preflights from unlisted origins are refused too.
public sealed class OriginPolicyMiddleware(RequestDelegate next, AuthOptions options)
{
    public const string Message = "This origin is not allowed.";

    public Task InvokeAsync(HttpContext context)
    {
        var origin = context.Request.Headers.Origin;
        if (
            !HttpMethods.IsGet(context.Request.Method)
            && !string.IsNullOrEmpty(origin.ToString())
            && !options.AllowedOrigins.Contains(origin.ToString(), StringComparer.Ordinal)
        )
            return ApiErrors.WriteAsync(context, 403, Message);
        return next(context);
    }
}
