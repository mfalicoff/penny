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
    public static async Task CopyAsync<T>(
        PennyDbContext context,
        IReadOnlyCollection<T> rows,
        CancellationToken cancellationToken
    )
        where T : class
    {
        if (rows.Count == 0)
            return;
        var entity =
            context.Model.FindEntityType(typeof(T))
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
