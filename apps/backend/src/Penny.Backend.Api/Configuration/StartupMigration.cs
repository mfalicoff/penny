using Npgsql;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;

namespace Penny.Backend.Api.Configuration;

// Applies pending migrations before the API serves, with the API's own database user
// (ConnectionStrings__Postgres), as self-hosted apps do. Registered before every other
// hosted service, so workers and Kestrel start only on a migrated schema. Waits for a
// database that is still starting and for another replica's migration; any other failure
// stops the host. Logs name the reason (MigrationFailure: the exception type, Penny's own
// message, the SQLSTATE) but no credentials, SQL or row values.
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
                await CheckClientConnectionChecksAsync(database, cancellationToken);
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
                    error is MigrationLockedException ? "migration-lock" : "database",
                    MigrationFailure.Describe(error)
                );
                await Task.Delay(Pause, time, cancellationToken);
            }
            catch (Exception error)
                when (error is not OperationCanceledException
                    || !cancellationToken.IsCancellationRequested
                )
            {
                // The original exception stays out of the host's own failure log, which
                // would print its message and stack.
                LogFailed(logger, MigrationFailure.Describe(error));
                throw new InvalidOperationException(
                    "Database migration failed on startup. See the preceding log entry."
                );
            }
        }
    }

    // MAZ-261: when a command times out and PostgreSQL doesn't acknowledge the cancellation
    // within a second, Npgsql closes the socket. Without client_connection_check_interval,
    // PostgreSQL only notices once the statement finishes, so it keeps running and holding
    // its locks, blocking other users' writes. Penny's bundled servers set it; an external
    // server may not, so say so on startup. Best effort: never stops the host.
    private async Task CheckClientConnectionChecksAsync(
        NpgsqlDataSource database,
        CancellationToken cancellationToken
    )
    {
        try
        {
            await using var command = database.CreateCommand(
                "SELECT current_setting('client_connection_check_interval')"
            );
            if (await command.ExecuteScalarAsync(cancellationToken) is "0")
                LogClientChecksOff(logger);
        }
        catch (Exception error) when (error is NpgsqlException or TimeoutException) { }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static bool Waitable(Exception error) =>
        error is MigrationLockedException or TimeoutException
        || (error is NpgsqlException database && database.IsTransient);

    [LoggerMessage(Level = LogLevel.Information, Message = "Database migrated.")]
    private static partial void LogMigrated(ILogger logger);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "PostgreSQL has client_connection_check_interval off: a statement whose request timed out keeps running and holding its locks. Set it to 1s on the server (docs/self-hosting/deployment.md#client-connection-checks)."
    )]
    private static partial void LogClientChecksOff(ILogger logger);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Waiting to migrate the database ({Reason}): {Failure}"
    )]
    private static partial void LogWaiting(ILogger logger, string reason, string failure);

    [LoggerMessage(
        Level = LogLevel.Critical,
        Message = "Database migration failed on startup: {Reason}"
    )]
    private static partial void LogFailed(ILogger logger, string reason);
}
