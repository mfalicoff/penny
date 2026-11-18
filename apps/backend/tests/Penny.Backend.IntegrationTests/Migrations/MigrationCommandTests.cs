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
    public async Task whenConnectionProvided_MigrationCommand_ShouldPersistSchemaWithoutStartingHttp()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        var result = await RunAsync(Fixture.Connection, "migrate");
        result.ExitCode.ShouldBe(0, result.Error);
        result.Output.ShouldContain("migration complete");
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT count(*) FROM penny.\"__EFMigrationsHistory\""
        );
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(
            (long)context.Database.GetMigrations().Count()
        );
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenUserCannotCreateSchema_MigrationCommand_ShouldFailWithoutExposingSecrets()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        var role = "limited_" + Guid.NewGuid().ToString("N")[..12];
        var password = Guid.NewGuid().ToString("N");
        // Only generated hexadecimal names and passwords are interpolated.
        await Fixture.SqlAsync($"CREATE ROLE {role} LOGIN PASSWORD '{password}'", Ct);
        try
        {
            var connection = new NpgsqlConnectionStringBuilder(Fixture.Connection)
            {
                Username = role,
                Password = password,
            }.ConnectionString;
            var result = await RunAsync(connection, "migrate");
            result.ExitCode.ShouldBe(1);
            result.Error.ShouldContain("privileges");
            result.Error.ShouldNotContain(password);
            result.Error.ShouldNotContain("Password=");
        }
        finally
        {
            await Fixture.SqlAsync($"DROP ROLE {role}", Ct);
        }
    }

    [Theory]
    [InlineData("--bootstrap")]
    [InlineData("--grant-runtime")]
    public async Task whenRetiredOptionGiven_MigrationCommand_ShouldPrintUsage(string option)
    {
        var result = await RunAsync(Fixture.Connection, "migrate", option);
        result.ExitCode.ShouldBe(1);
        result.Error.ShouldContain("command-usage");
    }

    private static Task<(int ExitCode, string Output, string Error)> RunAsync(
        string connection,
        params string[] arguments
    ) =>
        MaintenanceProcess.RunAsync(
            null,
            arguments,
            Ct,
            new Dictionary<string, string> { ["ConnectionStrings__Postgres"] = connection }
        );
}
