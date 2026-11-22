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
            result.Error.ShouldContain(
                "Database migration failed: PostgresException: SQLSTATE 42501 (insufficient_privilege)"
            );
            result.Error.ShouldNotContain(password);
            result.Error.ShouldNotContain("Password=");
        }
        finally
        {
            await Fixture.SqlAsync($"DROP ROLE {role}", Ct);
        }
    }

    [Fact]
    public async Task whenPasswordWrong_MigrationCommand_ShouldReportSqlStateWithoutPassword()
    {
        var wrong = Guid.NewGuid().ToString("N");
        var connection = new NpgsqlConnectionStringBuilder(Fixture.Connection)
        {
            Password = wrong,
        }.ConnectionString;
        var result = await RunAsync(connection, "migrate");
        result.ExitCode.ShouldBe(1);
        result.Error.ShouldContain(
            "Database migration failed: PostgresException: SQLSTATE 28P01 (invalid_password)"
        );
        result.Error.ShouldNotContain(wrong);
        result.Error.ShouldNotContain("Password=");
    }

    [Fact]
    public async Task whenSchemaNewer_MigrationCommand_ShouldSaySo()
    {
        await Fixture.SqlAsync(
            """INSERT INTO penny."__EFMigrationsHistory" VALUES ('29990101000000_Future', '10.0.14')""",
            Ct
        );
        try
        {
            var result = await RunAsync(Fixture.Connection, "migrate");
            result.ExitCode.ShouldBe(1);
            result.Error.ShouldContain(
                "Database migration failed: DatabaseSetupException: Database schema is newer than this build. No migration was applied."
            );
        }
        finally
        {
            await Fixture.SqlAsync(
                """DELETE FROM penny."__EFMigrationsHistory" WHERE "MigrationId" = '29990101000000_Future'""",
                Ct
            );
        }
    }

    [Fact]
    public async Task whenAnotherMigrationHoldsLock_MigrationCommand_ShouldNameTheLock()
    {
        await using var holder = await Fixture.Admin.OpenConnectionAsync(Ct);
        await using (var take = new NpgsqlCommand("SELECT pg_advisory_lock($1)", holder))
        {
            take.Parameters.Add(
                new NpgsqlParameter<long> { TypedValue = DatabaseSchema.MigrationLock }
            );
            await take.ExecuteNonQueryAsync(Ct);
        }
        try
        {
            var result = await RunAsync(Fixture.Connection, "migrate");
            result.ExitCode.ShouldBe(1);
            result.Error.ShouldContain(
                "Database migration failed: MigrationLockedException: Another database migration holds the lock."
            );
        }
        finally
        {
            // A pooled connection would keep the session lock until its next use.
            await using var release = new NpgsqlCommand("SELECT pg_advisory_unlock_all()", holder);
            await release.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task whenExtensionsMissingAndUserCannotCreateThem_MigrationCommand_ShouldSaySo()
    {
        // A database without the search extensions, where the application user may create
        // pg_trgm (a trusted extension) but not vector.
        var database = "noext_" + Guid.NewGuid().ToString("N")[..12];
        // Only a generated hexadecimal name is interpolated.
        await Fixture.SqlAsync($"CREATE DATABASE {database}", Ct);
        try
        {
            await Fixture.SqlAsync(
                $"GRANT CONNECT, CREATE ON DATABASE {database} TO penny_app",
                Ct
            );
            var connection = new NpgsqlConnectionStringBuilder(Fixture.Connection)
            {
                Database = database,
            }.ConnectionString;
            var result = await RunAsync(connection, "migrate");
            result.ExitCode.ShouldBe(1);
            result.Error.ShouldContain(
                $"Database migration failed: DatabaseSetupException: {SearchExtensions.Missing}"
            );
        }
        finally
        {
            await Fixture.SqlAsync($"DROP DATABASE {database} WITH (FORCE)", Ct);
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
