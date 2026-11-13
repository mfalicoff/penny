using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class MigrationCommandTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenMigrationCredentialsProvided_MigrationCommand_ShouldPersistSchemaWithoutStartingHttp()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        var result = await RunAsync(Fixture.MigrationConnection);
        result.ExitCode.ShouldBe(0, result.Error);
        result.Output.ShouldContain("migration complete");
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT count(*) FROM penny.\"__EFMigrationsHistory\""
        );
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(
            (long)context.Database.GetMigrations().Count()
        );
    }

    [Fact]
    public async Task whenGrantRuntimeRequested_MigrationCommand_ShouldLeaveRuntimeRoleReady()
    {
        // A fresh schema has no runtime grants: the shared runtime host is not ready
        // until the same command that migrated also applied grant-runtime.sql.
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await Fixture.SqlAsync(
            "CREATE SCHEMA penny AUTHORIZATION penny_migrator; GRANT USAGE ON SCHEMA penny TO penny_runtime",
            Ct
        );
        var migrated = await RunAsync(Fixture.MigrationConnection);
        migrated.ExitCode.ShouldBe(0, migrated.Error);
        using (var before = await Client.GetAsync("/api/ready", Ct))
            before.StatusCode.ShouldBe(System.Net.HttpStatusCode.ServiceUnavailable);
        var granted = await RunAsync(Fixture.MigrationConnection, "--grant-runtime");
        granted.ExitCode.ShouldBe(0, granted.Error);
        granted.Output.ShouldContain("Runtime grants applied.");
        using (var after = await Client.GetAsync("/api/ready", Ct))
            after.StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
    }

    [Fact]
    public void whenGrantScriptEmbedded_RuntimeGrants_ShouldMatchRepositoryFile()
    {
        var file = Path.Combine(
            AppContext.BaseDirectory,
            "..",
            "..",
            "..",
            "..",
            "..",
            "development",
            "grant-runtime.sql"
        );
        Penny.Backend.Persistence.Migrations.RuntimeGrants.Sql().ShouldBe(File.ReadAllText(file));
    }

    [Fact]
    public async Task whenRuntimeCredentialsProvided_MigrationCommand_ShouldFailWithoutExposingSecrets()
    {
        var result = await RunAsync(Fixture.RuntimeConnection);
        result.ExitCode.ShouldBe(1);
        result.Error.ShouldContain("migration-role");
        result.Error.ShouldNotContain(Fixture.RuntimeConnection);
        result.Error.ShouldNotContain("Password=");
    }

    [Fact]
    public void whenBootstrapScriptEmbedded_DatabaseBootstrap_ShouldMatchRepositoryFile()
    {
        var file = Path.Combine(
            AppContext.BaseDirectory,
            "..",
            "..",
            "..",
            "..",
            "..",
            "development",
            "bootstrap.sql"
        );
        Penny
            .Backend.Persistence.Migrations.DatabaseBootstrap.Sql()
            .ShouldBe(File.ReadAllText(file));
    }

    [Fact]
    public async Task whenBootstrapRequested_MigrationCommand_ShouldBeRepeatableAndRotateRolePasswords()
    {
        // Like a new database: no penny schema. The roles already exist (the fixture made
        // them), so bootstrap leaves them in place and makes the configured passwords
        // authoritative. The migration password is rotated and then restored, so the shared
        // fixture keeps its credentials.
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        var rotated = new NpgsqlConnectionStringBuilder(Fixture.MigrationConnection)
        {
            Password = Guid.NewGuid().ToString("N"),
        }.ConnectionString;
        var first = await RunAsync(rotated, Bootstrap(), "--bootstrap", "--grant-runtime");
        var second = await RunAsync(rotated, Bootstrap(), "--grant-runtime", "--bootstrap");
        var oldPassword = await RunAsync(Fixture.MigrationConnection);
        var restored = await RunAsync(Fixture.MigrationConnection, Bootstrap(), "--bootstrap");
        restored.ExitCode.ShouldBe(0, restored.Error);

        first.ExitCode.ShouldBe(0, first.Error);
        first.Output.ShouldContain("Database bootstrap complete.");
        first.Output.ShouldContain("Runtime grants applied.");
        second.ExitCode.ShouldBe(0, second.Error);
        oldPassword.ExitCode.ShouldBe(1);
        await using (
            var owner = Fixture.Admin.CreateCommand(
                "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'penny'"
            )
        )
            (await owner.ExecuteScalarAsync(Ct)).ShouldBe("penny_migrator");
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenBootstrapRoleNamesDiffer_MigrationCommand_ShouldFailWithoutExposingSecrets()
    {
        var environment = Bootstrap();
        environment["ConnectionStrings__Postgres"] = new NpgsqlConnectionStringBuilder(
            Fixture.RuntimeConnection
        )
        {
            Username = "someone_else",
        }.ConnectionString;
        var result = await RunAsync(Fixture.MigrationConnection, environment, "--bootstrap");
        result.ExitCode.ShouldBe(1);
        result.Error.ShouldContain("bootstrap-configuration");
        result.Error.ShouldNotContain("Password=");
    }

    private Dictionary<string, string> Bootstrap() =>
        new()
        {
            ["ConnectionStrings__Admin"] = Fixture.AdminConnection,
            ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
        };

    private static Task<(int ExitCode, string Output, string Error)> RunAsync(
        string connection,
        params string[] options
    ) => RunAsync(connection, [], options);

    private static async Task<(int ExitCode, string Output, string Error)> RunAsync(
        string connection,
        Dictionary<string, string> environment,
        params string[] options
    )
    {
        var entry = typeof(Program).Assembly.Location;
        var start = new ProcessStartInfo(
            Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet"
        )
        {
            WorkingDirectory = Path.GetDirectoryName(entry)!,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(entry);
        start.ArgumentList.Add("migrate");
        foreach (var option in options)
            start.ArgumentList.Add(option);
        start.Environment["ConnectionStrings__Migration"] = connection;
        foreach (var (key, value) in environment)
            start.Environment[key] = value;
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(Ct);
        var error = process.StandardError.ReadToEndAsync(Ct);
        try
        {
            await process.WaitForExitAsync(Ct).WaitAsync(TimeSpan.FromSeconds(15), Ct);
        }
        finally
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        return (process.ExitCode, await output, await error);
    }
}
