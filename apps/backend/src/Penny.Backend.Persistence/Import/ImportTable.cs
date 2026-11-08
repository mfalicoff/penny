namespace Penny.Backend.Persistence.Import;

internal sealed record ImportTable(string Name, ImportColumn[] Columns, string[] Keys);
