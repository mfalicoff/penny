using Npgsql;

namespace Penny.Backend.Persistence;

public sealed class DatabaseSettings
{
    private readonly NpgsqlConnectionStringBuilder connection;

    private DatabaseSettings(NpgsqlConnectionStringBuilder connection) =>
        this.connection = connection;

    public static DatabaseSettings Create(
        string? value,
        int maxPoolSize = 20,
        int connectTimeoutSeconds = 5,
        int commandTimeoutSeconds = 5
    )
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException(
                "Set ConnectionStrings__Postgres (or ConnectionStrings__Migration for the migration command)."
            );
        if (
            maxPoolSize is < 1 or > 100
            || connectTimeoutSeconds is < 1 or > 30
            || commandTimeoutSeconds is < 1 or > 30
        )
            throw new InvalidOperationException(
                "Database pool size must be 1–100; connection and command timeouts must be 1–30 seconds."
            );

        NpgsqlConnectionStringBuilder parsed;
        try
        {
            parsed = new NpgsqlConnectionStringBuilder(value);
        }
        catch (ArgumentException)
        {
            throw new InvalidOperationException(
                "The PostgreSQL connection string is invalid. Check its keys and syntax."
            );
        }
        if (
            string.IsNullOrWhiteSpace(parsed.Host)
            || string.IsNullOrWhiteSpace(parsed.Database)
            || string.IsNullOrWhiteSpace(parsed.Username)
        )
            throw new InvalidOperationException(
                "The PostgreSQL connection string requires Host, Database and Username."
            );
        parsed.Pooling = true;
        parsed.MinPoolSize = 0;
        parsed.MaxPoolSize = maxPoolSize;
        parsed.Timeout = connectTimeoutSeconds;
        parsed.CommandTimeout = commandTimeoutSeconds;
        parsed.CancellationTimeout = 1000;
        parsed.IncludeErrorDetail = false;
        parsed.LogParameters = false;
        parsed.PersistSecurityInfo = false;
        parsed.ApplicationName = "penny-backend";
        return new DatabaseSettings(parsed);
    }

    public NpgsqlDataSource CreateDataSource() =>
        NpgsqlDataSource.Create(connection.ConnectionString);

    public override string ToString() => "PostgreSQL settings (credentials redacted)";
}
