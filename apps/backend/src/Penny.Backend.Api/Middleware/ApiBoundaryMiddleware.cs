using System.Diagnostics;
using Microsoft.AspNetCore.Http.Features;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Errors;

namespace Penny.Backend.Api.Middleware;

public sealed partial class ApiBoundaryMiddleware(
    RequestDelegate next,
    BackendOptions options,
    ILogger<ApiBoundaryMiddleware> logger
)
{
    internal static readonly object ClientCancellation = new();

    public async Task InvokeAsync(HttpContext context)
    {
        context.Items[ClientCancellation] = context.RequestAborted;
        context.Response.OnStarting(() =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            return Task.CompletedTask;
        });
        var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (context.Request.ContentLength is { } declared && declared > options.MaxRequestBodyBytes)
        {
            await DiscardOversizedBodyAsync(context, limit, declared);
            await ApiErrors.WriteAsync(context, 413, "The upload is too large.");
            return;
        }
        if (limit is { IsReadOnly: false })
            limit.MaxRequestBodySize = options.MaxRequestBodyBytes;
        try
        {
            await next(context);
            if (
                !context.Response.HasStarted
                && context.Response.StatusCode >= 400
                && context.Response.ContentType is null
            )
                await ApiErrors.WriteAsync(
                    context,
                    context.Response.StatusCode,
                    context.Response.StatusCode == 404
                        ? "API route not found."
                        : "The request could not be completed."
                );
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            context.Abort();
        }
        catch (Exception error) when (!context.Response.HasStarted)
        {
            var (status, message) = ApiErrors.Map(error);
            // Deliberately do not log exception text, request paths/bodies, credentials or SQL.
            // The W3C trace id (MAZ-127) finds the request trace; "-" when not traced.
            if (status == 500)
                RequestFailed(
                    logger,
                    error.GetType().Name,
                    context.TraceIdentifier,
                    Activity.Current?.TraceId.ToHexString() ?? "-"
                );
            // A dependency timeout (search statement timeout) is retryable.
            if (status == 503)
                context.Response.Headers.RetryAfter = "1";
            await ApiErrors.WriteAsync(context, status, message);
        }
    }

    // Replying before reading a declared body and then closing the connection resets
    // it while the client is still writing, so clients that send the whole body
    // before reading (fetch, URLSession, HttpClient) lose the 413 and report a network
    // error. A body moderately over the limit (a slightly too large receipt) is read
    // and discarded first, bounded by size and the request timeout, so the connection
    // closes cleanly. Larger declared bodies are refused at once: the connection is
    // closed rather than read, and such a client may see a reset.
    private async Task DiscardOversizedBodyAsync(
        HttpContext context,
        IHttpMaxRequestBodySizeFeature? limit,
        long declared
    )
    {
        if (
            limit is not { IsReadOnly: false }
            || declared - options.MaxRequestBodyBytes > DrainAllowance(options)
        )
            return;
        limit.MaxRequestBodySize = declared;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted
        );
        deadline.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        try
        {
            await context.Request.Body.CopyToAsync(Stream.Null, deadline.Token);
        }
        catch (Exception error)
            when (error is IOException or OperationCanceledException or BadHttpRequestException)
        {
            // Best effort: the 413 is still written; Kestrel closes the connection.
        }
    }

    // How far over the limit a declared body may be and still be discarded: a quarter
    // of the limit, at least 1 MiB (5 MiB for the default 20 MiB limit).
    internal static long DrainAllowance(BackendOptions options) =>
        Math.Max(1024 * 1024, options.MaxRequestBodyBytes / 4);

    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "API request failed ({ExceptionType}); request {RequestId}, trace {TraceId}"
    )]
    private static partial void RequestFailed(
        ILogger logger,
        string exceptionType,
        string requestId,
        string traceId
    );
}
