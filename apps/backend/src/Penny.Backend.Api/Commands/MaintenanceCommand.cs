using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;

namespace Penny.Backend.Api.Commands;

// `migrate [--bootstrap] [--grant-runtime]` and `bootstrap`: schema changes with the
// migration (and, for the bootstrap, administrator) credentials. Never starts HTTP.
internal static class MaintenanceCommand
{
    private const string Usage =
        "Usage: migrate [--bootstrap] [--grant-runtime] | bootstrap | reset-password EMAIL. See apps/backend/README.md.";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        var valid =
            args is ["bootstrap"]
            || (
                args is ["migrate", ..]
                && args.Skip(1).All(option => option is "--bootstrap" or "--grant-runtime")
                && args.Skip(1).Distinct().Count() == args.Length - 1
            );
        if (!valid)
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
            // Roles, schema and extensions only, without migrating: an empty server that a
            // backup is restored into needs the roles that own its objects.
            if (args is ["bootstrap"] || args.Contains("--bootstrap"))
            {
                if (!await BootstrapAsync(configuration, stopping.Token))
                {
                    Console.Error.WriteLine("bootstrap-configuration");
                    Console.Error.WriteLine(Usage);
                    return 1;
                }
                Console.WriteLine("Database bootstrap complete.");
                if (args is ["bootstrap"])
                    return 0;
            }
            var settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Migration"),
                maxPoolSize: 1
            );
            await using var database = settings.CreateDataSource();
            await DatabaseMigrator.ApplyAsync(database, stopping.Token);
            Console.WriteLine("Database migration complete.");
            if (args.Contains("--grant-runtime"))
            {
                await RuntimeGrants.ApplyAsync(database, stopping.Token);
                Console.WriteLine("Runtime grants applied.");
            }
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
                "Database migration failed. Check connectivity, PostgreSQL 18, schema compatibility, migration-role privileges and the migration lock. No credentials or row values are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }

    // The administrator connection is used only here. The role passwords come from the
    // connection strings the migration and the API use, so they cannot drift apart.
    // Returns false when those connection strings do not name the expected roles.
    private static async Task<bool> BootstrapAsync(
        IConfiguration configuration,
        CancellationToken cancellationToken
    )
    {
        var migration = new Npgsql.NpgsqlConnectionStringBuilder(
            configuration.GetConnectionString("Migration") ?? ""
        );
        var runtime = new Npgsql.NpgsqlConnectionStringBuilder(
            configuration.GetConnectionString("Postgres") ?? ""
        );
        if (
            migration.Username != DatabaseBootstrap.MigrationRole
            || runtime.Username != DatabaseBootstrap.RuntimeRole
            || string.IsNullOrEmpty(migration.Password)
            || string.IsNullOrEmpty(runtime.Password)
        )
            return false;
        var settings = DatabaseSettings.Create(
            configuration.GetConnectionString("Admin"),
            maxPoolSize: 1
        );
        await using var administrator = settings.CreateDataSource();
        await DatabaseBootstrap.ApplyAsync(
            administrator,
            migration.Password,
            runtime.Password,
            cancellationToken
        );
        return true;
    }
}
