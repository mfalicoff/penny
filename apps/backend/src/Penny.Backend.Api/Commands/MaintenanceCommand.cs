using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;

namespace Penny.Backend.Api.Commands;

// `migrate`: applies pending migrations with ConnectionStrings__Postgres and exits, for
// operators who run the API with Database__MigrateOnStartup=false. The API does the same
// on startup by default. Never starts HTTP.
internal static class MaintenanceCommand
{
    public const string Name = "migrate";

    private const string Usage = "Usage: migrate. See apps/backend/README.md.";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        if (args is not [Name])
        {
            Console.Error.WriteLine("command-usage");
            Console.Error.WriteLine(Usage);
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
            var settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Postgres"),
                maxPoolSize: 1
            );
            await using var database = settings.CreateDataSource();
            await DatabaseMigrator.ApplyAsync(database, stopping.Token);
            Console.WriteLine("Database migration complete.");
            return 0;
        }
        catch (Exception error)
            when (error
                    is Npgsql.NpgsqlException
                        or TimeoutException
                        or OperationCanceledException
                        or InvalidOperationException
                        or IOException
                        or UnauthorizedAccessException
                        or ArgumentException
                        or Microsoft.EntityFrameworkCore.DbUpdateException
            )
        {
            Console.Error.WriteLine(
                "Database migration failed. Check connectivity, PostgreSQL 18, the search extensions, schema compatibility, the database user's privileges and the migration lock. No credentials or row values are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
