using Npgsql;
using Penny.Backend.Application;

namespace Penny.Backend.Persistence;

public sealed class PostgresReadiness(NpgsqlDataSource source) : IStorageReadiness
{
    public async Task<StorageStatus> CheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await source.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(
                System.Data.IsolationLevel.RepeatableRead,
                cancellationToken
            );
            await using var query = new NpgsqlCommand(
                """
                SELECT current_setting('server_version_num')::int,
                       (SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm' AND extnamespace = 'public'::regnamespace),
                       to_regclass('penny.schema_version') IS NOT NULL,
                       (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user)
                         OR has_database_privilege(current_user, current_database(), 'CREATE')
                """,
                connection,
                transaction
            );
            bool exists;
            await using (var reader = await query.ExecuteReaderAsync(cancellationToken))
            {
                await reader.ReadAsync(cancellationToken);
                if (reader.GetInt32(0) / 10000 != DatabaseSchema.PostgresMajor)
                    return new(false, "postgres-version");
                if (reader.IsDBNull(1) || reader.GetString(1) != DatabaseSchema.TrigramVersion)
                    return new(false, "extension");
                exists = reader.GetBoolean(2);
                if (reader.GetBoolean(3))
                    return new(false, "runtime-role");
            }
            if (!exists)
                return new(false, "schema");
            await using var version = new NpgsqlCommand(
                """
                SELECT version, has_schema_privilege(current_user, 'penny', 'CREATE'),
                       has_schema_privilege(current_user, 'public', 'CREATE')
                FROM penny.schema_version WHERE singleton = TRUE
                """,
                connection,
                transaction
            );
            await using var row = await version.ExecuteReaderAsync(cancellationToken);
            if (
                !await row.ReadAsync(cancellationToken)
                || row.GetInt32(0) != DatabaseSchema.Version
            )
                return new(false, "schema");
            if (row.GetBoolean(1) || row.GetBoolean(2))
                return new(false, "runtime-role");
            return new(true, "ready");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (PostgresException error)
            when (error.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            return new(false, "permissions");
        }
        catch (NpgsqlException)
        {
            return new(false, "unavailable");
        }
        catch (TimeoutException)
        {
            return new(false, "unavailable");
        }
    }
}
