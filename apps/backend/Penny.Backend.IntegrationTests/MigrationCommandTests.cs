using System.Diagnostics;
using Penny.Backend.Persistence;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests;

public sealed class MigrationCommandTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task Explicit_CLI_command_runs_with_migration_credentials_without_starting_an_HTTP_server()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE; DROP EXTENSION pg_trgm", Ct);
        var result = await RunAsync(Fixture.MigrationConnection);
        result.ExitCode.ShouldBe(0, result.Error);
        result.Output.ShouldContain("migration complete");
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT version FROM penny.schema_version"
        );
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(DatabaseSchema.Version);
    }

    [Fact]
    public async Task Runtime_credentials_cannot_run_CLI_migrations_and_failure_has_no_secrets()
    {
        var result = await RunAsync(Fixture.RuntimeConnection);
        result.ExitCode.ShouldBe(1);
        result.Error.ShouldContain("migration-role");
        result.Error.ShouldNotContain(Fixture.RuntimeConnection);
        result.Error.ShouldNotContain("Password=");
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunAsync(
        string connection
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
