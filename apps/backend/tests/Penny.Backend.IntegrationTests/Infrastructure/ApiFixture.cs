using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;
using Penny.Backend.Persistence.Configuration;
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
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder(DatabaseSchema.Image)
        .WithDatabase("penny_tests")
        .WithUsername("foundation_admin")
        .WithPassword(Guid.NewGuid().ToString("N"))
        .Build();

    public NpgsqlDataSource Admin { get; private set; } = null!;
    public TestApiFactory Factory { get; private set; } = null!;
    public string RuntimeConnection { get; private set; } = "";
    public string MigrationConnection { get; private set; } = "";
    public string ReceiptRoot { get; } =
        System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "penny-receipts-" + Guid.NewGuid().ToString("N")
        );
    public string ReceiptKey { get; } =
        Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    public ReceiptFileStore Receipts => new(ReceiptStoreSettings.Create(ReceiptRoot, ReceiptKey));

    public async ValueTask InitializeAsync()
    {
        var ct = TestContext.Current.CancellationToken;
        await postgres.StartAsync(ct);
        Admin = DatabaseSettings.Create(postgres.GetConnectionString()).CreateDataSource();
        await DatabaseMigrator.ApplyAsync(Admin, ct);
        var password = Guid.NewGuid().ToString("N");
        var migrationPassword = Guid.NewGuid().ToString("N");
        await SqlAsync(
            $"CREATE ROLE penny_migrator LOGIN PASSWORD '{migrationPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE",
            ct
        );
        await SqlAsync(
            "GRANT CONNECT, CREATE ON DATABASE penny_tests TO penny_migrator; GRANT CREATE ON SCHEMA public TO penny_migrator",
            ct
        );
        MigrationConnection = new NpgsqlConnectionStringBuilder(postgres.GetConnectionString())
        {
            Username = "penny_migrator",
            Password = migrationPassword,
        }.ConnectionString;
        // Only a generated hexadecimal test password is interpolated; no user input.
        await SqlAsync(
            $"CREATE ROLE penny_runtime LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE",
            ct
        );
        await GrantRuntimeAsync(ct);
        RuntimeConnection = new NpgsqlConnectionStringBuilder(postgres.GetConnectionString())
        {
            Username = "penny_runtime",
            Password = password,
        }.ConnectionString;
        // The shared host opens receipts written through `Receipts`.
        Factory = new TestApiFactory(
            RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = ReceiptRoot,
                ["Receipts:MasterKey"] = ReceiptKey,
            }
        );
        Factory.UseKestrel(0);
        Factory.StartServer();
    }

    // Mirrors development/grant-runtime.sql.
    public Task GrantRuntimeAsync(CancellationToken ct) =>
        SqlAsync(
            """
            GRANT CONNECT ON DATABASE penny_tests TO penny_runtime;
            GRANT USAGE ON SCHEMA penny TO penny_runtime;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA penny TO penny_runtime;
            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON penny."__EFMigrationsHistory", penny.sqlite_import FROM penny_runtime;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA penny TO penny_runtime;
            """,
            ct
        );

    public async Task SqlAsync(string sql, CancellationToken ct)
    {
        await using var command = Admin.CreateCommand(sql);
        await command.ExecuteNonQueryAsync(ct);
    }

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
        // Compatibility tests deliberately destroy schema or history. Only those
        // cases rebuild; ordinary tests retain migration history and use Respawn.
        try
        {
            await DatabaseMigrator.ApplyAsync(Admin, ct);
        }
        catch (Exception error) when (error is InvalidOperationException or PostgresException)
        {
            await SqlAsync("DROP SCHEMA IF EXISTS penny CASCADE", ct);
            await DatabaseMigrator.ApplyAsync(Admin, ct);
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
        await SqlAsync(
            "REVOKE CREATE ON SCHEMA penny, public FROM penny_runtime; REVOKE CREATE ON DATABASE penny_tests FROM penny_runtime",
            ct
        );
        await GrantRuntimeAsync(ct);
        if (Directory.Exists(ReceiptRoot))
            Directory.Delete(ReceiptRoot, recursive: true);
        Factory.Services.GetRequiredService<ProbeSignals>().Reset();
        Factory.Clock.Reset();
    }

    public async ValueTask DisposeAsync()
    {
        if (Factory is not null)
            await Factory.DisposeAsync();
        if (Admin is not null)
            await Admin.DisposeAsync();
        await postgres.DisposeAsync();
        if (Directory.Exists(ReceiptRoot))
            Directory.Delete(ReceiptRoot, recursive: true);
    }
}
