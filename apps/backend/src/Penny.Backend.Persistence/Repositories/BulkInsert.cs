using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

// Inserts new rows with one binary COPY on the context's connection and transaction
// (MAZ-137). EF inserts tracked rows one statement each, which is too slow for a first
// sync of a full ledger. The table, columns and types come from the EF model, so the
// COPY follows the schema; database-generated columns (identities) are left out. Rows
// copied here are not tracked: call after `SaveChanges` has written the rows they
// reference, and before commit.
internal static class BulkInsert
{
    // From this many rows, a COPY is followed by ANALYZE of its table (MAZ-271).
    internal const int AnalyzeRows = 1_000;

    public static async Task CopyAsync<T>(
        PennyDbContext context,
        IReadOnlyCollection<T> rows,
        CancellationToken cancellationToken
    )
        where T : class
    {
        if (rows.Count == 0)
            return;
        var entity = context.Model.FindEntityType(typeof(T))
            ?? throw new InvalidOperationException($"{typeof(T).Name} is not mapped.");
        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        var columns = entity
            .GetProperties()
            .Where(property => property.ValueGenerated == ValueGenerated.Never)
            .Select(property =>
            {
                var mapping = property.GetRelationalTypeMapping();
                return (
                    Property: property,
                    Name: property.GetColumnName(table)!,
                    Type: mapping.StoreTypeNameBase,
                    Converter: mapping.Converter
                );
            })
            .ToList();
        // Identifiers come from the EF model, never from a request.
        var name = Quote(table.Schema!) + "." + Quote(table.Name);
        var copy = string.Create(
            CultureInfo.InvariantCulture,
            $"COPY {name} ({string.Join(", ", columns.Select(column => Quote(column.Name)))}) FROM STDIN (FORMAT BINARY)"
        );
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();
        // Disposing an importer that was not completed cancels the COPY; the caller's
        // transaction then rolls back. It is disposed before the ANALYZE below, because
        // the connection runs nothing else while it is open.
        await using (
            var importer = await connection.BeginBinaryImportAsync(copy, cancellationToken)
        )
        {
            foreach (var row in rows)
            {
                await importer.StartRowAsync(cancellationToken);
                foreach (var column in columns)
                {
                    var value = column.Property.GetGetter().GetClrValue(row);
                    if (value is not null && column.Converter is { } converter)
                        value = converter.ConvertToProvider(value);
                    if (value is null)
                        await importer.WriteNullAsync(cancellationToken);
                    else
                        await importer.WriteAsync(value, column.Type, cancellationToken);
                }
            }
            await importer.CompleteAsync(cancellationToken);
        }
        // Later statements in this transaction look rows up in this table: the next
        // COPY's foreign-key checks (each search document's entry) run one query per
        // row. Their plans come from the table's statistics, which do not count rows this
        // transaction has not committed. If VACUUM records them mid-write (autovacuum
        // after another user's deletes, for example) the table looks empty, the planner
        // picks the smallest index that matches `user_id` instead of the primary key, and
        // every check scans the user's whole ledger: minutes for a full ledger (MAZ-271).
        // ANALYZE in this transaction counts the copied rows, and its lock keeps VACUUM
        // from replacing those statistics until commit. Small copies skip it: their
        // checks are few, and committed rows already dominate the statistics.
        if (rows.Count < AnalyzeRows)
            return;
        await using var analyze = new NpgsqlCommand("ANALYZE " + name, connection);
        await analyze.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string Quote(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}
