using Npgsql;
using Penny.Backend.Persistence.Migrations;

namespace Penny.Backend.Persistence.Schema;

// Presence and version of the extensions search needs (raw SQL inventory: a read of
// pg_extension, and CREATE EXTENSION when they are missing). Used by the migration
// (creates them, or refuses to run) and readiness (503).
public static class SearchExtensions
{
    public const string Missing =
        "PostgreSQL extensions vector (pgvector 0.8 or later) and pg_trgm are missing and the database user cannot create them. Create them as an administrator (docs/reference/search.md). No migration was applied.";

    // Creates missing extensions in `public`, in one transaction, so a user that may
    // create pg_trgm (a trusted extension) but not vector leaves nothing behind. Throws
    // Missing when the user lacks the privilege or the server's versions are too old.
    public static async Task EnsureAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken
    )
    {
        if (await AvailableAsync(connection, cancellationToken))
            return;
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (
                var command = new NpgsqlCommand(
                    $"CREATE EXTENSION IF NOT EXISTS {SearchSchema.Trigrams} SCHEMA public; CREATE EXTENSION IF NOT EXISTS {SearchSchema.Vector} SCHEMA public",
                    connection,
                    transaction
                )
            )
                await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (PostgresException error)
            when (error.SqlState
                    is PostgresErrorCodes.InsufficientPrivilege
                        or PostgresErrorCodes.UndefinedFile
                        or PostgresErrorCodes.FeatureNotSupported
            )
        {
            throw new DatabaseSetupException(Missing);
        }
        if (!await AvailableAsync(connection, cancellationToken))
            throw new DatabaseSetupException(Missing);
    }

    public static async Task<bool> AvailableAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken
    )
    {
        await using var command = new NpgsqlCommand(
            "SELECT extname, extversion FROM pg_extension WHERE extname = ANY($1)",
            connection
        );
        command.Parameters.Add(
            new NpgsqlParameter<string[]>
            {
                TypedValue = [SearchSchema.Vector, SearchSchema.Trigrams],
            }
        );
        var versions = new Dictionary<string, string>(StringComparer.Ordinal);
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            while (await reader.ReadAsync(cancellationToken))
                versions[reader.GetString(0)] = reader.GetString(1);
        return AtLeast(versions, SearchSchema.Vector, SearchSchema.MinimumVector)
            && AtLeast(versions, SearchSchema.Trigrams, SearchSchema.MinimumTrigrams);
    }

    private static bool AtLeast(
        Dictionary<string, string> versions,
        string name,
        Version minimum
    ) =>
        versions.TryGetValue(name, out var text)
        && Version.TryParse(text, out var version)
        && version >= minimum;
}
