using Npgsql;

namespace Penny.Backend.Persistence.Schema;

// Presence and version of the extensions search needs (raw SQL inventory: a read of
// pg_extension). Used by `migrate` (refuses to run) and readiness (503).
public static class SearchExtensions
{
    public const string Missing =
        "PostgreSQL extensions vector (pgvector 0.8 or later) and pg_trgm must be created by an administrator before migrating. See docs/migration/search.md. No migration was applied.";

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
