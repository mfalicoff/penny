using System.Diagnostics;
using Npgsql;
using Pgvector.Npgsql;

namespace Penny.Backend.Persistence.Configuration;

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
        // MAZ-63: no Kerberos/GSS negotiation unless the operator asks for it; the
        // default probe needs libgssapi, which the runtime image does not ship.
        // (Npgsql's builder reports every known keyword as present, so ask a plain one.)
        var given = new System.Data.Common.DbConnectionStringBuilder { ConnectionString = value };
        if (!given.ContainsKey("GSS Encryption Mode") && !given.ContainsKey("GssEncryptionMode"))
            parsed.GssEncryptionMode = GssEncryptionMode.Disable;
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

    // Names the pool in Npgsql metrics (never the connection string, MAZ-127).
    public const string DataSourceName = "penny-backend";

    // pgvector maps `vector` columns (search embeddings, MAZ-121). Npgsql spans
    // (MAZ-127, exported only when the host enables OpenTelemetry) cover commands run
    // inside a request or worker span, so idle worker polling records none. Statements
    // carry no parameter values: Npgsql never records them and LogParameters is off.
    public NpgsqlDataSource CreateDataSource()
    {
        var builder = new NpgsqlDataSourceBuilder(connection.ConnectionString)
        {
            Name = DataSourceName,
        };
        builder.UseVector();
        builder.ConfigureTracing(tracing =>
            tracing
                .ConfigureCommandFilter(_ => Activity.Current is not null)
                .ConfigureBatchFilter(_ => Activity.Current is not null)
                .EnableFirstResponseEvent(false)
        );
        return builder.Build();
    }

    public override string ToString() => "PostgreSQL settings (credentials redacted)";
}
