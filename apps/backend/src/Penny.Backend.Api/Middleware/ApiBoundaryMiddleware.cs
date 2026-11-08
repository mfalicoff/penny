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
        if (limit is { IsReadOnly: false })
            limit.MaxRequestBodySize = options.MaxRequestBodyBytes;
        if (context.Request.ContentLength > options.MaxRequestBodyBytes)
        {
            await ApiErrors.WriteAsync(context, 413, "The upload is too large.");
            return;
        }
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
            if (status == 500)
                RequestFailed(logger, error.GetType().Name, context.TraceIdentifier);
            await ApiErrors.WriteAsync(context, status, message);
        }
    }

    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "API request failed ({ExceptionType}); trace {TraceId}"
    )]
    private static partial void RequestFailed(ILogger logger, string exceptionType, string traceId);
}
