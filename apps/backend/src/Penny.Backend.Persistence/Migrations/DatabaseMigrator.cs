using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Migrations;

public static class DatabaseMigrator
{
    // Applies pending EF Core migrations. EF takes its own lock on the history table;
    // the advisory lock additionally excludes the SQLite importer for the whole run.
    public static async Task ApplyAsync(
        NpgsqlDataSource source,
        CancellationToken cancellationToken
    )
    {
        await using var guard = await source.OpenConnectionAsync(cancellationToken);
        if (guard.PostgreSqlVersion.Major != DatabaseSchema.PostgresMajor)
            throw new InvalidOperationException(
                "PostgreSQL 18 is required. No migration was applied."
            );
        if (!await SearchExtensions.AvailableAsync(guard, cancellationToken))
            throw new InvalidOperationException(SearchExtensions.Missing);
        await AcquireLockAsync(guard, cancellationToken);
        try
        {
            await using var context = PennyDbContext.Create(guard);
            context.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
            var known = context.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
            var applied = await context.Database.GetAppliedMigrationsAsync(cancellationToken);
            if (applied.Any(migration => !known.Contains(migration)))
                throw new InvalidOperationException(
                    "Database schema is newer than this build. No migration was applied."
                );
            await context.Database.MigrateAsync(cancellationToken);
        }
        finally
        {
            await ReleaseLockAsync(guard);
        }
    }

    // Session-level lock shared by `migrate` and `import-sqlite`.
    internal static async Task AcquireLockAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection);
        command.Parameters.Add(
            new NpgsqlParameter<long> { TypedValue = DatabaseSchema.MigrationLock }
        );
        if (await command.ExecuteScalarAsync(ct) is not true)
            throw new InvalidOperationException(
                "Another database migration or import holds the lock. Retry after it completes."
            );
    }

    internal static async Task ReleaseLockAsync(NpgsqlConnection connection)
    {
        if (connection.State != System.Data.ConnectionState.Open)
            return;
        await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock($1)", connection)
        {
            CommandTimeout = 5,
        };
        command.Parameters.Add(
            new NpgsqlParameter<long> { TypedValue = DatabaseSchema.MigrationLock }
        );
        await command.ExecuteNonQueryAsync(CancellationToken.None);
    }
}
