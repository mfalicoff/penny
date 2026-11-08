namespace Penny.Backend.Persistence.Import;

public sealed class ImportFailure(string code, string? table = null, long? row = null)
    : Exception(
        $"SQLite import rejected: {code}." + (table is null ? "" : $" Table {table}, row {row}.")
    )
{
    public string Code { get; } = code;
}
