namespace Penny.Backend.Persistence.Import;

// Typed access to one validated legacy SQLite row (see ImportValue.Read).
internal sealed class LegacyRow(ImportTable table, object[] values)
{
    public string Text(string column) => (string)Value(column);

    public string? OptionalText(string column) => Value(column) as string;

    public long Long(string column) => (long)Value(column);

    public long? OptionalLong(string column) => Value(column) is long value ? value : null;

    public bool Bool(string column) => (bool)Value(column);

    public DateOnly Date(string column) => (DateOnly)Value(column);

    public DateOnly? OptionalDate(string column) => Value(column) is DateOnly value ? value : null;

    public byte[] Bytes(string column) => (byte[])Value(column);

    public DateTimeOffset Time(string column) => ImportValue.Time(Long(column));

    public DateTimeOffset? OptionalTime(string column) =>
        OptionalLong(column) is long value ? ImportValue.Time(value) : null;

    // Only household_audit rows carry the source rowid after their columns.
    public long RowId => (long)values[^1];

    private object Value(string column)
    {
        var index = Array.FindIndex(table.Columns, c => c.Name == column);
        return index < 0
            ? throw new InvalidOperationException("Unknown legacy column.")
            : values[index];
    }
}
