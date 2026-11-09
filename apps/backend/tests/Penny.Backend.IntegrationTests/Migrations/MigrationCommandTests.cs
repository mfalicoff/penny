using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
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

    private static async Task<(int ExitCode, string Output, string Error)> RunAsync(
        string connection,
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
