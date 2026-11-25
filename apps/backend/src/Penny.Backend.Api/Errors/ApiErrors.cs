using System.Text.Json;
using Npgsql;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Errors;

public static class ApiErrors
{
    public const string ReceiptChanged =
        "A receipt changed while you were saving. Reload and try again.";
    public const string InvalidRequest = "Invalid request.";
    public const string InvalidJson = "Invalid JSON.";
    public const string TooLarge = "The upload is too large.";
    public const string RouteNotFound = "API route not found.";

    private static PostgresException? PostgresError(Exception error) =>
        error as PostgresException ?? error.InnerException as PostgresException;

    public static (int Status, string Code, string Message) Map(Exception error) =>
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
                    FailureKind.RateLimited => 429,
                    _ => 500,
                },
                failure.Code,
                failure.Message
            ),
            BadHttpRequestException { StatusCode: 413 } => (
                413,
                ErrorCodes.RequestTooLarge,
                TooLarge
            ),
            BadHttpRequestException bad => (
                bad.StatusCode,
                ErrorCodes.RequestInvalid,
                InvalidRequest
            ),
            JsonException => (400, ErrorCodes.RequestInvalidJson, InvalidJson),
            // Races with emailed receipt cleanup (MAZ-184): a receipt deleted between a
            // save's validation and its insert, or two transactions locking the same rows in
            // opposite order. Both are retryable after a reload, never server bugs.
            _ when PostgresError(error)
                    is { SqlState: PostgresErrorCodes.ForeignKeyViolation } violation
                    && violation.ConstraintName?.Contains("_receipts_", StringComparison.Ordinal)
                        == true => (409, ErrorCodes.ReceiptChanged, ReceiptChanged),
            _ when PostgresError(error) is { SqlState: PostgresErrorCodes.DeadlockDetected } => (
                503,
                ErrorCodes.ServerBusy,
                "The server was busy. Please retry."
            ),
            _ => (500, ErrorCodes.ServerError, "The server could not complete this request."),
        };

    public static Task WriteAsync(
        HttpContext context,
        int status,
        string code,
        string message,
        CancellationToken? cancellationToken = null
    )
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(
            new ApiError(message, code),
            cancellationToken ?? context.RequestAborted
        );
    }
}
