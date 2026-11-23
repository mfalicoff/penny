using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;

namespace Penny.Backend.Api.Commands;

// `verify-email EMAIL` (MAZ-172): marks an account's current email verified, for servers
// without email delivery or a person who can't receive the link. Uses the runtime
// connection (DML only) and never starts HTTP. Nothing is written to a log.
internal static class EmailVerificationCommand
{
    public const string Name = "verify-email";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        if (args is not [Name, var email])
        {
            Console.Error.WriteLine(
                "Usage: verify-email EMAIL. See docs/reference/authentication.md#email-verification-maz-172."
            );
            return 1;
        }
        DatabaseSettings settings;
        try
        {
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
            var service = new EmailVerificationService(
                new PostgresAccountRepository(database),
                new PostgresEmailVerificationRepository(database),
                new PostgresMailOutbox(database),
                MailPolicy.Off,
                TimeProvider.System
            );
            Console.Error.WriteLine(
                await service.MarkVerifiedAsync(email, stopping.Token)
                    ? "Marked the account's email as verified."
                    : "The account's email was already verified. Nothing changed."
            );
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
                "Email verification failed. Check ConnectionStrings__Postgres, connectivity and that the database has been migrated. No credentials or emails are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
