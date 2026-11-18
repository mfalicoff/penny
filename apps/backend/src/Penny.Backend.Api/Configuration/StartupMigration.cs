using Npgsql;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;

namespace Penny.Backend.Api.Configuration;

// Applies pending migrations before the API serves, with the API's own database user
// (ConnectionStrings__Postgres), as self-hosted apps do. Registered before every other
// hosted service, so workers and Kestrel start only on a migrated schema. Waits for a
// database that is still starting and for another replica's migration; any other failure
// stops the host. Logs carry no credentials, SQL or exception details.
// Database__MigrateOnStartup=false turns it off (then run the `migrate` command).
internal sealed partial class StartupMigration(
    DatabaseSettings settings,
    ILogger<StartupMigration> logger
) : IHostedService
{
    private static readonly TimeSpan Patience = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Pause = TimeSpan.FromSeconds(2);

    // Wall-clock time: test controls may swap the injected clock.
    private static readonly TimeProvider time = TimeProvider.System;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var database = settings.CreateDataSource();
        var deadline = time.GetUtcNow() + Patience;
        while (true)
        {
            try
            {
                await DatabaseMigrator.ApplyAsync(database, cancellationToken);
                LogMigrated(logger);
                return;
            }
            catch (Exception error)
                when (Waitable(error)
                    && time.GetUtcNow() < deadline
                    && !cancellationToken.IsCancellationRequested
                )
            {
                LogWaiting(
                    logger,
                    error is MigrationLockedException ? "migration-lock" : "database"
                );
                await Task.Delay(Pause, time, cancellationToken);
            }
            catch (Exception error) when (Reportable(error))
            {
                // Our own messages (PostgreSQL version, extensions, newer schema) are safe;
                // database errors are reduced to their SQLSTATE.
                LogFailed(
                    logger,
                    error is PostgresException postgres ? postgres.SqlState
                        : error is InvalidOperationException ? error.Message
                        : error.GetType().Name
                );
                throw new InvalidOperationException(
                    "Database migration failed on startup. See the preceding log entry."
                );
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static bool Waitable(Exception error) =>
        error is MigrationLockedException or TimeoutException
        || (error is NpgsqlException database && database.IsTransient);

    private static bool Reportable(Exception error) =>
        error
            is NpgsqlException
                or TimeoutException
                or InvalidOperationException
                or Microsoft.EntityFrameworkCore.DbUpdateException;

    [LoggerMessage(Level = LogLevel.Information, Message = "Database migrated.")]
    private static partial void LogMigrated(ILogger logger);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Waiting to migrate the database ({Reason})."
    )]
    private static partial void LogWaiting(ILogger logger, string reason);

    [LoggerMessage(
        Level = LogLevel.Critical,
        Message = "Database migration failed on startup: {Reason}"
    )]
    private static partial void LogFailed(ILogger logger, string reason);
}
