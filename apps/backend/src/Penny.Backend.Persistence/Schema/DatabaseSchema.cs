namespace Penny.Backend.Persistence.Schema;

public static class DatabaseSchema
{
    public const int Version = 1;
    public const int PostgresMajor = 18;
    public const string TrigramVersion = "1.6";
    public const long MigrationLock = 0x50454E4E59;
    public const string Image =
        "docker.io/library/postgres:18.6@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42";
}
