using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Health;

// Read-only: never migrates, creates or repairs anything (startup migrates).
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
            if (!await SearchExtensions.AvailableAsync(connection, cancellationToken))
                return new(false, "search-extensions");
            var applied = await context.Database.GetAppliedMigrationsAsync(cancellationToken);
            if (
                !applied
                    .Order(StringComparer.Ordinal)
                    .SequenceEqual(context.Database.GetMigrations().Order(StringComparer.Ordinal))
            )
                return new(false, "schema");
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
}
