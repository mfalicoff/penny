using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Respawn;
using Respawn.Graph;
using Testcontainers.PostgreSql;
using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

public sealed class ApiFixture : IAsyncLifetime
{
    // Port of the second PostgreSQL instance the point-in-time recovery rehearsal starts
    // inside this container (published now, listened on only during that test).
    public const int RecoveryPort = 5433;

    // WAL archive used by the recovery rehearsal. Segments are copied only while the
    // directory exists, so other tests pay nothing and nothing accumulates.
    public const string WalArchive = "/var/lib/postgresql/wal-archive";

    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder(DatabaseSchema.Image)
        .WithDatabase("penny_tests")
        .WithUsername("foundation_admin")
        .WithPassword(Guid.NewGuid().ToString("N"))
        .WithCommand(
            "-c",
            "archive_mode=on",
            "-c",
            $"archive_command=if [ -d {WalArchive} ]; then test ! -f {WalArchive}/%f && cp %p {WalArchive}/%f; fi"
        )
        .WithPortBinding(RecoveryPort, true)
        .Build();

    public const string CreateExtensions =
        "CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector SCHEMA public";

    public NpgsqlDataSource Admin { get; private set; } = null!;
    public TestApiFactory Factory { get; private set; } = null!;

    // The application user (`penny_app`), as in production: it owns the penny schema and
    // migrates it; the administrator only created it and the search extensions.
    public string Connection { get; private set; } = "";
    public NpgsqlDataSource App { get; private set; } = null!;

    // Superuser connection to the test database (benchmark diagnostics only).
    public string AdminConnection => postgres.GetConnectionString();

    // The PostgreSQL server log (benchmark auto_explain plans).
    public async Task<string> ServerLogAsync() => (await postgres.GetLogsAsync()).Stderr;

    public string ReceiptRoot { get; } =
        System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "penny-receipts-" + Guid.NewGuid().ToString("N")
        );
    public string ReceiptKey { get; } =
        Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    public const string InboundMailDomain = "receipts.example.test";
    public const int InboundMailMaxBytes = 1024 * 1024;
    public byte[] InboundMailSecret { get; } =
        System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
    public InboundMailSealer InboundMail =>
        new(ReceiptStoreSettings.Create(ReceiptRoot, ReceiptKey));
    public ReceiptFileStore Receipts => new(ReceiptStoreSettings.Create(ReceiptRoot, ReceiptKey));

    public async ValueTask InitializeAsync()
    {
        var ct = TestContext.Current.CancellationToken;
        await postgres.StartAsync(ct);
        Admin = DatabaseSettings.Create(postgres.GetConnectionString()).CreateDataSource();
        // Like an external PostgreSQL: the administrator creates the search extensions
        // and a non-superuser that may create schemas; the application does the rest.
        await SqlAsync(CreateExtensions, ct);
        var password = Guid.NewGuid().ToString("N");
        // Only a generated hexadecimal test password is interpolated; no user input.
        await SqlAsync(
            $"CREATE ROLE penny_app LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE",
            ct
        );
        await SqlAsync("GRANT CONNECT, CREATE ON DATABASE penny_tests TO penny_app", ct);
        Connection = new NpgsqlConnectionStringBuilder(postgres.GetConnectionString())
        {
            Username = "penny_app",
            Password = password,
        }.ConnectionString;
        App = DatabaseSettings.Create(Connection).CreateDataSource();
        await DatabaseMigrator.ApplyAsync(App, ct);
        // The shared host opens receipts written through `Receipts`.
        Factory = new TestApiFactory(
            Connection,
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = ReceiptRoot,
                ["Receipts:MasterKey"] = ReceiptKey,
                // Emailed receipts (MAZ-184) are on in the shared host; suites that need
                // them off derive a host with `InboundMail:Enabled=false`.
                ["InboundMail:Enabled"] = "true",
                ["InboundMail:Domain"] = InboundMailDomain,
                ["InboundMail:WebhookSecret"] = Convert.ToBase64String(InboundMailSecret),
                ["InboundMail:MaxMessageBytes"] = InboundMailMaxBytes.ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
            }
        );
        Factory.UseKestrel(0);
        Factory.StartServer();
    }

    public async Task SqlAsync(string sql, CancellationToken ct)
    {
        await using var command = Admin.CreateCommand(sql);
        await command.ExecuteNonQueryAsync(ct);
    }

    // Runs a command in the PostgreSQL container, failing with its output on error.
    public async Task<string> ExecAsync(IList<string> command, CancellationToken ct)
    {
        var result = await postgres.ExecAsync(command, ct);
        if (result.ExitCode != 0)
            throw new InvalidOperationException(
                $"Container command failed ({result.ExitCode}): {result.Stderr}{result.Stdout}"
            );
        return result.Stdout;
    }

    // `connection` (any role of the test database) pointed at the recovery instance.
    public string RecoveredConnection(string connection) =>
        new NpgsqlConnectionStringBuilder(connection)
        {
            Host = postgres.Hostname,
            Port = postgres.GetMappedPublicPort(RecoveryPort),
        }.ConnectionString;

    public async Task<RestoredDatabase> RestoreBackupAsync(CancellationToken ct)
    {
        var name = "restore_" + Guid.NewGuid().ToString("N");
        var dump = "/tmp/" + name + ".dump";
        await SqlAsync($"CREATE DATABASE {name}", ct);
        var copy = new RestoredDatabase(
            DatabaseSettings
                .Create(
                    new NpgsqlConnectionStringBuilder(postgres.GetConnectionString())
                    {
                        Database = name,
                    }.ConnectionString
                )
                .CreateDataSource(),
            Admin,
            name
        );
        try
        {
            await using (var create = copy.Source.CreateCommand(CreateExtensions))
                await create.ExecuteNonQueryAsync(ct);
            var backup = await postgres.ExecAsync(
                [
                    "pg_dump",
                    "--username=foundation_admin",
                    "--dbname=penny_tests",
                    "--schema=penny",
                    "--format=custom",
                    "--no-owner",
                    "--file=" + dump,
                ],
                ct
            );
            if (backup.ExitCode != 0)
                throw new InvalidOperationException("Synthetic PostgreSQL backup failed.");
            var restore = await postgres.ExecAsync(
                [
                    "pg_restore",
                    "--username=foundation_admin",
                    "--dbname=" + name,
                    "--no-owner",
                    "--no-privileges",
                    "--exit-on-error",
                    dump,
                ],
                ct
            );
            if (restore.ExitCode != 0)
                throw new InvalidOperationException("Synthetic PostgreSQL restore failed.");
            return copy;
        }
        catch
        {
            await copy.DisposeAsync();
            throw;
        }
        finally
        {
            await postgres.ExecAsync(["rm", "-f", dump], CancellationToken.None);
        }
    }

    public async Task ResetAsync(CancellationToken ct)
    {
        // Migration tests deliberately destroy schema or history, or rebuild it as another
        // owner. Only those cases rebuild; ordinary tests retain migration history and use
        // Respawn.
        try
        {
            if (!await OwnedByAppAsync(ct))
                throw new InvalidOperationException("The penny schema has another owner.");
            await DatabaseMigrator.ApplyAsync(App, ct);
        }
        catch (Exception error) when (error is InvalidOperationException or PostgresException)
        {
            await SqlAsync("DROP SCHEMA IF EXISTS penny CASCADE", ct);
            await DatabaseMigrator.ApplyAsync(App, ct);
        }
        await using var connection = await Admin.OpenConnectionAsync(ct);
        var reset = await Respawner.CreateAsync(
            connection,
            new RespawnerOptions
            {
                DbAdapter = DbAdapter.Postgres,
                SchemasToInclude = ["penny"],
                TablesToIgnore = [new Table("penny", PennyDbContext.HistoryTable)],
            }
        );
        await reset.ResetAsync(connection);
        // Tests may revoke the owner's own table privileges; give them back.
        await SqlAsync("GRANT ALL ON ALL TABLES IN SCHEMA penny TO penny_app", ct);
        if (Directory.Exists(ReceiptRoot))
            Directory.Delete(ReceiptRoot, recursive: true);
        Factory.Services.GetRequiredService<ProbeSignals>().Reset();
        Factory.Clock.Reset();
    }

    private async Task<bool> OwnedByAppAsync(CancellationToken ct)
    {
        await using var command = Admin.CreateCommand(
            "SELECT COALESCE((SELECT nspowner::regrole::text = 'penny_app' FROM pg_namespace WHERE nspname = 'penny'), true)"
        );
        return await command.ExecuteScalarAsync(ct) is true;
    }

    public async ValueTask DisposeAsync()
    {
        if (Factory is not null)
            await Factory.DisposeAsync();
        if (App is not null)
            await App.DisposeAsync();
        if (Admin is not null)
            await Admin.DisposeAsync();
        await postgres.DisposeAsync();
        if (Directory.Exists(ReceiptRoot))
            Directory.Delete(ReceiptRoot, recursive: true);
    }
}
