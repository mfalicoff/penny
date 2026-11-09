using System.Diagnostics;
using Microsoft.AspNetCore.Routing;

namespace Penny.Backend.Api.Middleware;

// MAZ-63: every request carries a correlation id. A well-formed `X-Request-Id` from
// the reverse proxy is kept (nginx `$request_id`), anything else is replaced. The id
// becomes the trace identifier, is echoed in the response and scopes every log line
// of the request. One access line per request records the method, the route template
// (never the concrete path or query), the status and the duration.
public sealed partial class RequestCorrelationMiddleware(
    RequestDelegate next,
    ILogger<RequestCorrelationMiddleware> logger
)
{
    public const string Header = "X-Request-Id";
    public const int MaxLength = 64;

    public async Task InvokeAsync(HttpContext context)
    {
        var id = IsWellFormed(context.Request.Headers[Header].ToString())
            ? context.Request.Headers[Header].ToString()
            : Guid.NewGuid().ToString("N");
        context.TraceIdentifier = id;
        context.Response.Headers[Header] = id;
        using var scope = logger.BeginScope(
            new KeyValuePair<string, object>[] { new("RequestId", id) }
        );
        var started = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        finally
        {
            RequestCompleted(
                logger,
                context.Request.Method,
                (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(unmatched)",
                context.RequestAborted.IsCancellationRequested ? 499 : context.Response.StatusCode,
                Stopwatch.GetElapsedTime(started).TotalMilliseconds
            );
        }
    }

    public static bool IsWellFormed(string value)
    {
        if (value.Length is 0 or > MaxLength)
            return false;
        foreach (var character in value)
            if (!(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.' or ':'))
                return false;
        return true;
    }

    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "HTTP {Method} {Route} responded {StatusCode} in {ElapsedMilliseconds:0.0} ms"
    )]
    private static partial void RequestCompleted(
        ILogger logger,
        string method,
        string route,
        int statusCode,
        double elapsedMilliseconds
    );
}
