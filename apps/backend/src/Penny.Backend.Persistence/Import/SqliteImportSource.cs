using System.Data;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using NpgsqlTypes;

namespace Penny.Backend.Persistence.Import;

internal sealed class SqliteImportSource : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly SqliteTransaction transaction;
    public string Path { get; }
    public string Sha256 { get; }

    public SqliteImportSource(string path, string expectedSha256)
    {
        Path = path;
        // A snapshot is a standalone database, never a copied live main file.
        if (File.Exists(path + "-wal") || File.Exists(path + "-journal"))
            throw new ImportFailure("unsealed-source-use-snapshot-command");
        Sha256 = SqliteSnapshot.Hash(path);
        if (!string.Equals(Sha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
            throw new ImportFailure("source-checksum-mismatch");
        connection = SqliteSnapshot.OpenReadOnly(path);
        transaction = connection.BeginTransaction(IsolationLevel.Serializable, deferred: true);
        try
        {
            ValidateSchema();
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    private void ValidateSchema()
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "PRAGMA user_version";
        if (
            Convert.ToInt64(
                command.ExecuteScalar(),
                System.Globalization.CultureInfo.InvariantCulture
            ) != 2
        )
            throw new ImportFailure("unsupported-source-schema");
        command.CommandText = "PRAGMA integrity_check";
        if (command.ExecuteScalar() is not "ok")
            throw new ImportFailure("corrupt-source");
        command.CommandText = "PRAGMA foreign_key_check";
        using (var rows = command.ExecuteReader())
            if (rows.Read())
                throw new ImportFailure("source-foreign-key");
        command.CommandText =
            "SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE BINARY";
        var names = new List<string>();
        using (var rows = command.ExecuteReader())
            while (rows.Read())
                names.Add(rows.GetString(0));
        if (
            !names.SequenceEqual(
                ImportSchema.Tables.Select(t => t.Name).Order(StringComparer.Ordinal)
            )
        )
            throw new ImportFailure("source-schema-drift");
        foreach (var table in ImportSchema.Tables)
        {
            command.CommandText = $"PRAGMA table_info(\"{table.Name}\")";
            var found = new Dictionary<string, string>(StringComparer.Ordinal);
            var keys = new SortedDictionary<int, string>();
            using (var rows = command.ExecuteReader())
                while (rows.Read())
                {
                    found.Add(rows.GetString(1), rows.GetString(2).ToUpperInvariant());
                    if (rows.GetInt32(5) > 0)
                        keys.Add(rows.GetInt32(5), rows.GetString(1));
                }
            if (
                found.Count != table.Columns.Length
                || table.Columns.Any(c =>
                    !found.TryGetValue(c.Name, out var type) || type != SourceType(c.Type)
                )
            )
                throw new ImportFailure("source-column-drift", table.Name);
            if (!keys.Values.SequenceEqual(table.Keys))
                throw new ImportFailure("source-key-drift", table.Name);
            // Inspect actual indexes rather than trusting user_version alone. Target
            // constraints also validate every row even if a source constraint was bypassed.
            command.CommandText = $"PRAGMA index_list(\"{table.Name}\")";
            var indexes = new Dictionary<string, (bool Unique, bool Partial)>(
                StringComparer.Ordinal
            );
            using (var rows = command.ExecuteReader())
                while (rows.Read())
                    indexes.Add(rows.GetString(1), (rows.GetInt64(2) == 1, rows.GetInt64(4) == 1));
            foreach (var expected in ImportSchema.Indexes.Where(i => i.Table == table.Name))
            {
                if (
                    !indexes.TryGetValue(expected.Name, out var actual)
                    || actual.Unique != expected.Unique
                    || actual.Partial != (expected.Predicate is not null)
                )
                    throw new ImportFailure("source-index-drift", table.Name);
                command.CommandText = $"PRAGMA index_info(\"{expected.Name}\")";
                var columns = new List<string>();
                using (var rows = command.ExecuteReader())
                    while (rows.Read())
                        columns.Add(rows.GetString(2));
                if (!columns.SequenceEqual(expected.Columns))
                    throw new ImportFailure("source-index-drift", table.Name);
                if (expected.Predicate is not null)
                {
                    command.CommandText =
                        "SELECT sql FROM sqlite_master WHERE type='index' AND name=@name";
                    command.Parameters.AddWithValue("name", expected.Name);
                    var sql = (string)command.ExecuteScalar()!;
                    command.Parameters.Clear();
                    var predicate = sql[
                        (sql.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase) + 5)..
                    ]
                        .Trim()
                        .TrimEnd(';');
                    if (
                        !string.Equals(
                            predicate,
                            expected.Predicate,
                            StringComparison.OrdinalIgnoreCase
                        )
                    )
                        throw new ImportFailure("source-index-drift", table.Name);
                }
            }
        }
    }

    private static string SourceType(NpgsqlDbType type) =>
        type switch
        {
            NpgsqlDbType.Bigint or NpgsqlDbType.Boolean => "INTEGER",
            NpgsqlDbType.Bytea => "BLOB",
            _ => "TEXT",
        };

    public IEnumerable<object[]> ReadRows(
        ImportTable table,
        CancellationToken ct,
        bool auditOrder = false
    )
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        var values = string.Join(
            ",",
            table.Columns.Select(c =>
                c.Type is NpgsqlDbType.Text or NpgsqlDbType.Date or NpgsqlDbType.Jsonb
                    ? $"CAST(\"{c.Name}\" AS BLOB)"
                    : $"\"{c.Name}\""
            )
        );
        var types = string.Join(",", table.Columns.Select(c => $"typeof(\"{c.Name}\")"));
        var order =
            auditOrder && table.Name == "household_audit"
                ? "rowid"
                : string.Join(",", table.Keys.Select(k => $"\"{k}\" COLLATE BINARY"));
        command.CommandText =
            $"SELECT {values},{types}{(table.Name == "household_audit" ? ",rowid" : "")} FROM \"{table.Name}\" ORDER BY {order}";
        using var rows = command.ExecuteReader();
        long ordinal = 0;
        while (rows.Read())
        {
            ct.ThrowIfCancellationRequested();
            ordinal++;
            var converted = new object[
                table.Columns.Length + (table.Name == "household_audit" ? 1 : 0)
            ];
            try
            {
                for (var index = 0; index < table.Columns.Length; index++)
                    converted[index] = ImportValue.Read(
                        table.Columns[index],
                        rows.GetValue(index),
                        rows.GetString(table.Columns.Length + index)
                    );
                if (table.Name == "household_audit")
                    converted[^1] = rows.GetInt64(table.Columns.Length * 2);
            }
            catch (Exception error)
                when (error
                        is ImportFailure
                            or JsonException
                            or DecoderFallbackException
                            or InvalidOperationException
                            or FormatException
                            or KeyNotFoundException
                            or OverflowException
                            or ArgumentException
                )
            {
                throw new ImportFailure(
                    error is ImportFailure failure ? failure.Code : "invalid-value",
                    table.Name,
                    ordinal
                );
            }
            yield return converted;
        }
    }

    public void VerifyUnchanged()
    {
        if (
            SqliteSnapshot.Hash(Path) != Sha256
            || File.Exists(Path + "-wal")
            || File.Exists(Path + "-journal")
        )
            throw new ImportFailure("source-changed");
    }

    public void Dispose()
    {
        transaction.Dispose();
        connection.Dispose();
    }
}
