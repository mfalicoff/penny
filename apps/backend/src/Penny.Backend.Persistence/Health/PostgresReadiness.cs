using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Health;

// Read-only: never migrates, creates or repairs anything.
public sealed class PostgresReadiness(NpgsqlDataSource source) : IStorageReadiness
{
    public async Task<StorageStatus> CheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var context = PennyDbContext.Create(source);
            await context.Database.OpenConnectionAsync(cancellationToken);
            var connection = (NpgsqlConnection)context.Database.GetDbConnection();
            if (connection.PostgreSqlVersion.Major != DatabaseSchema.PostgresMajor)
                return new(false, "postgres-version");
            if (await HasSchemaPrivilegesAsync(connection, cancellationToken))
                return new(false, "runtime-role");
            if (!await SearchExtensions.AvailableAsync(connection, cancellationToken))
                return new(false, "search-extensions");
            var applied = await context.Database.GetAppliedMigrationsAsync(cancellationToken);
            if (
                !applied
                    .Order(StringComparer.Ordinal)
                    .SequenceEqual(context.Database.GetMigrations().Order(StringComparer.Ordinal))
            )
                return new(false, "schema");
            if (await context.SqliteImport.AnyAsync(i => i.Status != "complete", cancellationToken))
                return new(false, "import");
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
        catch (PostgresException error) when (error.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            return new(false, "schema");
        }
        catch (NpgsqlException)
        {
            return new(false, "unavailable");
        }
        catch (TimeoutException)
        {
            return new(false, "unavailable");
        }
        catch (InvalidOperationException)
        {
            return new(false, "unavailable");
        }
    }

    // The runtime role must not be able to change schema or administer the cluster.
    private static async Task<bool> HasSchemaPrivilegesAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken
    )
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user)
                OR has_database_privilege(current_user, current_database(), 'CREATE')
                OR has_schema_privilege(current_user, 'public', 'CREATE')
                OR COALESCE(has_schema_privilege(current_user, to_regnamespace('penny'), 'CREATE'), false)
            """,
            connection
        );
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }
}
