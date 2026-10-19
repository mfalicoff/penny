using System.Text.Json;
using Penny.Backend.Domain;

namespace Penny.Backend.Api;

public sealed class ApiErrorMiddleware(RequestDelegate next, ILogger<ApiErrorMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The caller has gone away. There is no response to write.
        }
        catch (Exception error) when (!context.Response.HasStarted)
        {
            var (status, message) = ApiErrors.Map(error);
            if (status == 500)
            {
                logger.LogError(error, "Unhandled API request failure");
            }
            await ApiErrors.WriteAsync(context, status, message);
        }
    }
}

public static class ApiErrors
{
    public static (int Status, string Message) Map(Exception error) => error switch
    {
        BackendFailure failure => failure.Kind switch
        {
            FailureKind.Invalid => (400, failure.Message),
            FailureKind.Unauthorized => (401, failure.Message),
            FailureKind.Forbidden => (403, failure.Message),
            FailureKind.NotFound => (404, failure.Message),
            FailureKind.Conflict => (409, failure.Message),
            _ => (500, "The server could not complete this request.")
        },
        BadHttpRequestException badRequest when badRequest.StatusCode == 413 => (413, "The upload is too large."),
        BadHttpRequestException => (400, "Invalid request."),
        JsonException => (400, "Invalid JSON."),
        _ => (500, "The server could not complete this request.")
    };

    public static async Task WriteAsync(HttpContext context, int status, string message)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new { error = message }, context.RequestAborted);
    }
}
