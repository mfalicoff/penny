using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Testing;

// Full-stack test environments only (MAZ-62): deletes every product row, keeping the
// migration history, so a seeded run starts from an empty,
// migrated database. It refuses any database whose name does not start with the
// configured test prefix, so a misrouted connection string cannot erase real data.
// Rows are deleted children-first in foreign-key order from the EF model; the runtime
// role has DELETE (not TRUNCATE), so no extra privilege is needed.
public sealed class TestDataReset(NpgsqlDataSource source)
{
    public static bool IsTestDatabase(string? database, string prefix) =>
        !string.IsNullOrEmpty(database)
        && prefix.Length > 0
        && database.StartsWith(prefix, StringComparison.Ordinal);

    public async Task<int> ResetAsync(string databasePrefix, CancellationToken cancellationToken)
    {
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        if (!IsTestDatabase(connection.Database, databasePrefix))
            throw new InvalidOperationException(
                "Test reset refused: the database is not a test database."
            );
        await using var context = PennyDbContext.Create(connection);
        var tables = DeleteOrder(context.Model);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        foreach (var table in tables)
        {
            // Table names come from the EF model, never from a request.
            await using var command = new NpgsqlCommand(
                $"DELETE FROM \"{PennyDbContext.SchemaName}\".\"{table}\"",
                connection,
                transaction
            );
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return tables.Count;
    }

    // Dependents before principals; the migration history is kept.
    public static IReadOnlyList<string> DeleteOrder(IModel model)
    {
        var tables = model
            .GetEntityTypes()
            .Where(type => type.GetTableName() is not null)
            .ToDictionary(type => type.GetTableName()!, StringComparer.Ordinal);
        var ordered = new List<string>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string table)
        {
            if (!visited.Add(table))
                return;
            // Every table that references this one is deleted first.
            foreach (
                var dependent in tables
                    .Where(pair =>
                        pair.Value.GetForeignKeys()
                            .Any(key =>
                                key.PrincipalEntityType.GetTableName() == table && pair.Key != table
                            )
                    )
                    .Select(pair => pair.Key)
                    .Order(StringComparer.Ordinal)
            )
                Visit(dependent);
            ordered.Add(table);
        }
        foreach (var table in tables.Keys.Order(StringComparer.Ordinal))
            Visit(table);
        return ordered;
    }
}
