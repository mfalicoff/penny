using Npgsql;

namespace Penny.Backend.Persistence;

public static class DatabaseMigrator
{
    // This bootstrap owns compatibility metadata only. Product schema/import is MAZ-52.
    public static async Task ApplyAsync(
        NpgsqlDataSource source,
        CancellationToken cancellationToken
    )
    {
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '10s'",
            connection,
            transaction
        );
        await command.ExecuteNonQueryAsync(cancellationToken);
        command.CommandText = "SELECT pg_try_advisory_xact_lock(@key)";
        command.Parameters.AddWithValue("key", DatabaseSchema.MigrationLock);
        if (await command.ExecuteScalarAsync(cancellationToken) is not true)
            throw new InvalidOperationException(
                "Another database migration holds the lock. Retry after it completes."
            );
        command.Parameters.Clear();
        command.CommandText = "SHOW server_version_num";
        var version = Convert.ToInt32(
            await command.ExecuteScalarAsync(cancellationToken),
            System.Globalization.CultureInfo.InvariantCulture
        );
        if (version / 10000 != DatabaseSchema.PostgresMajor)
            throw new InvalidOperationException(
                "The backend requires PostgreSQL 18. No migration was applied."
            );
        command.CommandText = """
            CREATE SCHEMA IF NOT EXISTS penny;
            CREATE TABLE IF NOT EXISTS penny.schema_version (
                singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
                version integer NOT NULL CHECK (version > 0)
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
        command.CommandText = "SELECT version FROM penny.schema_version WHERE singleton = TRUE";
        var existing = await command.ExecuteScalarAsync(cancellationToken);
        if (
            existing is not null
            && Convert.ToInt32(existing, System.Globalization.CultureInfo.InvariantCulture)
                != DatabaseSchema.Version
        )
            throw new InvalidOperationException(
                "Database schema version is incompatible. No migration was applied."
            );
        command.CommandText = """
            CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
            INSERT INTO penny.schema_version(singleton, version) VALUES (TRUE, 1) ON CONFLICT DO NOTHING;
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
        command.CommandText =
            "SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm' AND extnamespace = 'public'::regnamespace";
        if (
            await command.ExecuteScalarAsync(cancellationToken) is not DatabaseSchema.TrigramVersion
        )
            throw new InvalidOperationException(
                "pg_trgm is incompatible. No migration was applied."
            );
        await transaction.CommitAsync(cancellationToken);
    }
}
