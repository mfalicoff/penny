using System.Text.Json;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Errors;

public static class ApiErrors
{
    public static (int Status, string Message) Map(Exception error) =>
        error switch
        {
            BackendFailure failure => (
                failure.Kind switch
                {
                    FailureKind.Invalid => 400,
                    FailureKind.Unauthorized => 401,
                    FailureKind.Forbidden => 403,
                    FailureKind.NotFound => 404,
                    FailureKind.Conflict => 409,
                    FailureKind.Unavailable => 503,
                    _ => 500,
                },
                failure.Message
            ),
            BadHttpRequestException bad => (
                bad.StatusCode,
                bad.StatusCode == 413 ? "The upload is too large." : "Invalid request."
            ),
            JsonException => (400, "Invalid JSON."),
            _ => (500, "The server could not complete this request."),
        };

    public static Task WriteAsync(
        HttpContext context,
        int status,
        string message,
        CancellationToken? cancellationToken = null
    )
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(
            new ApiError(message),
            cancellationToken ?? context.RequestAborted
        );
    }
}
