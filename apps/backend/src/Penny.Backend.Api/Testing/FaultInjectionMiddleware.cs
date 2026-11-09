using Penny.Backend.Api.Errors;

namespace Penny.Backend.Api.Testing;

// Applies `http` fault rules before routing (registered only with test controls on).
// Control routes are never faulted, so a run can always clear its own rules.
public sealed class FaultInjectionMiddleware(RequestDelegate next, FaultRegistry faults)
{
    public const string ControlPrefix = "/api/test";
    public const string Message = "Injected test failure.";

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value;
        if (path is not null && path.StartsWith(ControlPrefix, StringComparison.Ordinal))
        {
            await next(context);
            return;
        }
        var rule = faults.Take("http", context.Request.Method, path);
        if (rule is null)
        {
            await next(context);
            return;
        }
        if (rule.DelayMs > 0)
            await Task.Delay(rule.DelayMs, context.RequestAborted);
        if (rule.Abort)
        {
            context.Abort();
            return;
        }
        if (rule.Status is { } status)
        {
            if (status == 503)
                context.Response.Headers.RetryAfter = "1";
            await ApiErrors.WriteAsync(context, status, Message);
            return;
        }
        await next(context);
    }
}
