namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class SqliteImportCheckpoint
{
    public bool Singleton { get; set; }
    public required string SourceSha256 { get; set; }
    public int SourceVersion { get; set; }
    public required string Status { get; set; }
    public string? Manifest { get; set; }
}
