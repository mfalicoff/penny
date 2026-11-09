namespace Penny.Backend.Persistence.Schema;

public static class DatabaseSchema
{
    public const int PostgresMajor = 18;
    public const long MigrationLock = 0x50454E4E59;

    // The official pgvector image (PostgreSQL 18.6 with pgvector 0.8.7, Debian trixie),
    // pinned by its multi-platform index digest; Compose uses the same reference.
    public const string Image =
        "docker.io/pgvector/pgvector:0.8.7-pg18-trixie@sha256:5895949dfcdf308eb0cd31c950c93c14895c77f33fbedfecf1fa511ab1d4bcd2";
}
