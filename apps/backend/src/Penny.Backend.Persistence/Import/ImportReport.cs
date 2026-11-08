namespace Penny.Backend.Persistence.Import;

public sealed record ImportReport(
    string SourceSha256,
    int SourceVersion,
    IReadOnlyList<ImportTableReport> Tables
);
