using System.Text.Json;
using Penny.Backend.Api.Errors;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Observability;

// MAZ-127 app counters around controller actions. Outcomes are recorded as a fixed
// failure vocabulary (the snake_case FailureKind, `invalid` or `error`); exceptions
// are rethrown unchanged for ApiBoundaryMiddleware, and client cancellation is not
// counted.
public static class Measured
{
    public const string Password = "password";
    public const string Oidc = "oidc";
    public const string Registration = "registration";

    public static async Task<T> SignInAsync<T>(string method, Func<Task<T>> action)
    {
        try
        {
            var result = await action();
            BackendTelemetry.SignIn(method, null);
            return result;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            BackendTelemetry.SignIn(method, FailureOf(error));
            throw;
        }
    }

    public static async Task<T> JoinAsync<T>(Func<Task<T>> action)
    {
        try
        {
            var result = await action();
            BackendTelemetry.HouseholdJoin(null);
            return result;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            BackendTelemetry.HouseholdJoin(FailureOf(error));
            throw;
        }
    }

    public static async Task<T> LedgerSaveAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return await action();
        }
        catch (BackendFailure failure) when (failure.Kind == FailureKind.Conflict)
        {
            BackendTelemetry.LedgerConflict();
            throw;
        }
    }

    public static string FailureOf(Exception error) =>
        error switch
        {
            BackendFailure failure => JsonNamingPolicy.SnakeCaseLower.ConvertName(
                failure.Kind.ToString()
            ),
            _ when ApiErrors.Map(error).Status is >= 400 and < 500 => "invalid",
            _ => "error",
        };
}
