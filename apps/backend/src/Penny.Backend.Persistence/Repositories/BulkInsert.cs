using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Npgsql;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

// Inserts new rows with binary COPY on the context's connection and transaction
// (MAZ-137), one COPY per batch of `BatchRows` rows. EF inserts tracked rows one statement each, which is too slow for a first
// sync of a full ledger. The table, columns and types come from the EF model, so the
// COPY follows the schema; database-generated columns (identities) are left out. Rows
// copied here are not tracked: call after `SaveChanges` has written the rows they
// reference, and before commit.
internal static class BulkInsert
{
    // Each COPY is one statement under `Database:CommandTimeoutSeconds` (5 s in
    // production). Index maintenance (the search documents' trigram and vector
    // indexes) makes one COPY of a full ledger's 100,000 rows take about 5 s even on a
    // fast machine (MAZ-262), so a full ledger is copied in batches that each finish
    // well inside the statement timeout. The request deadline still bounds the whole
    // write.
    internal const int BatchRows = 5_000;

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
        var copy = string.Create(
            CultureInfo.InvariantCulture,
            $"COPY {Quote(table.Schema!)}.{Quote(table.Name)} ({string.Join(", ", columns.Select(column => Quote(column.Name)))}) FROM STDIN (FORMAT BINARY)"
        );
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();
        foreach (var batch in rows.Chunk(BatchRows))
            await CopyBatchAsync(connection, copy, columns, batch, cancellationToken);
    }

    private static async Task CopyBatchAsync<T>(
        NpgsqlConnection connection,
        string copy,
        IReadOnlyList<(
            IProperty Property,
            string Name,
            string Type,
            ValueConverter? Converter
        )> columns,
        T[] rows,
        CancellationToken cancellationToken
    )
        where T : class
    {
        // Disposing an importer that was not completed cancels the COPY; the caller's
        // transaction then rolls back.
        await using var importer = await connection.BeginBinaryImportAsync(copy, cancellationToken);
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

    private static string Quote(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}
