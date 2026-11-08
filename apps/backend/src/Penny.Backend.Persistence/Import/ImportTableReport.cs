namespace Penny.Backend.Persistence.Import;

public sealed record ImportTableReport(string Table, long Count, string Sha256);
