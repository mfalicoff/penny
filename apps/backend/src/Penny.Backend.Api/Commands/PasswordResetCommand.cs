using System.Globalization;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;

namespace Penny.Backend.Api.Commands;

// `reset-password EMAIL` (MAZ-123): issues a single-use reset code for an account and
// prints it on stdout for the operator to deliver out of band. Uses the runtime
// connection (DML only) and never starts HTTP. stderr carries guidance and errors;
// nothing writes the code to a log.
internal static class PasswordResetCommand
{
    public const string Name = "reset-password";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        if (args is not [Name, var email])
        {
            Console.Error.WriteLine(
                "Usage: reset-password EMAIL. See docs/reference/authentication.md#password-reset."
            );
            return 1;
        }
        PasswordResetPolicy policy;
        DatabaseSettings settings;
        try
        {
            policy = BackendServices.PasswordResetPolicyFor(AuthOptions.Read(configuration));
            settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Postgres"),
                maxPoolSize: 1
            );
        }
        catch (InvalidOperationException error)
        {
            // Configuration errors name the setting and never include its value.
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        using var stopping = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, signal) =>
        {
            signal.Cancel = true;
            stopping.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            await using var database = settings.CreateDataSource();
            var service = new PasswordResetService(
                new PostgresAccountRepository(database),
                new PostgresPasswordResetRepository(database),
                new IdentityPasswordHasher(),
                policy,
                TimeProvider.System
            );
            var reset = await service.IssueAsync(email, stopping.Token);
            var expires = reset.ExpiresAt.UtcDateTime.ToString(
                "yyyy-MM-dd HH:mm 'UTC'",
                CultureInfo.InvariantCulture
            );
            Console.Error.WriteLine(
                $"Issued a password reset code. It expires at {expires}, can be used once and replaces any earlier code for this account."
            );
            if (!reset.HadPassword)
                Console.Error.WriteLine(
                    "This account had no password (single sign-on only); the reset adds one. Single sign-on keeps working."
                );
            Console.Error.WriteLine(
                "Deliver the code privately. The user enters it with a new password; every signed-in device is then signed out."
            );
            Console.WriteLine(reset.Token);
            return 0;
        }
        catch (BackendFailure failure)
        {
            Console.Error.WriteLine(failure.Message);
            return 1;
        }
        catch (Exception error)
            when (error
                    is Npgsql.NpgsqlException
                        or TimeoutException
                        or OperationCanceledException
                        or InvalidOperationException
                        or Microsoft.EntityFrameworkCore.DbUpdateException
            )
        {
            Console.Error.WriteLine(
                "Password reset failed. Check ConnectionStrings__Postgres, connectivity, that `migrate` has been applied with runtime grants, and retry if another reset for this account ran at the same time. No credentials, emails or codes are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
