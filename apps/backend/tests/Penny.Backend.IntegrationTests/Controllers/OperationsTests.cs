using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Api.Contracts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Migrations;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

public sealed class OperationsTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Theory]
    [InlineData("Backend:MaxRequestBodyBytes", "0")]
    [InlineData("Backend:RequestTimeoutSeconds", "infinite")]
    [InlineData("Backend:ShutdownTimeoutSeconds", "301")]
    [InlineData("Database:MaxPoolSize", "101")]
    public async Task whenHostConfigurationInvalid_CreateHost_ShouldFailBeforeAcceptingRequests(
        string key,
        string value
    )
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting(key, value)
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain(key);
    }

    [Fact]
    public async Task whenDatabaseConfigurationMissing_CreateHost_ShouldIdentifyRequiredSetting()
    {
        await using var factory = new TestApiFactory("");
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("ConnectionStrings__Postgres");
    }

    [Fact]
    public async Task whenRestrictedDatabaseCompatible_OperationsFlow_ShouldReturnHealthyResponses()
    {
        using var health = await Client.GetAsync("/api/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await health.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();
        health.Headers.CacheControl!.NoStore.ShouldBeTrue();
        health.Headers.GetValues("X-Content-Type-Options").Single().ShouldBe("nosniff");
        using var info = await Client.GetAsync("/api/info", Ct);
        var identity = await info.Content.ReadFromJsonAsync<JsonElement>(Ct);
        identity.GetProperty("name").GetString().ShouldBe("penny");
        identity.GetProperty("version").GetString().ShouldBe("1.0.0");
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("DROP TABLE penny.schema_version", "schema")]
    [InlineData("UPDATE penny.schema_version SET version=999", "schema")]
    [InlineData("DROP EXTENSION pg_trgm", "pg_trgm")]
    [InlineData("REVOKE SELECT ON penny.schema_version FROM penny_runtime", "grants")]
    [InlineData("GRANT CREATE ON SCHEMA penny TO penny_runtime", "restricted")]
    [InlineData("GRANT CREATE ON DATABASE penny_tests TO penny_runtime", "restricted")]
    public async Task whenDatabaseIncompatible_Readiness_ShouldFailWhileLivenessSurvives(
        string mutation,
        string errorFragment
    )
    {
        await Fixture.SqlAsync(mutation, Ct);
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        ready.Headers.RetryAfter!.Delta.ShouldBe(TimeSpan.FromSeconds(5));
        var error = await ready.Content.ReadFromJsonAsync<ApiError>(Ct);
        error!.Error.ShouldContain(errorFragment, Case.Insensitive);
        using var live = await Client.GetAsync("/api/health", Ct);
        live.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenDatabaseUnavailable_Readiness_ShouldReturnServiceUnavailableWithoutPrivateDetails()
    {
        // Port 1 is deliberately closed on loopback, not an external service.
        var password = Guid.NewGuid().ToString("N");
        await using var factory = new TestApiFactory(
            new NpgsqlConnectionStringBuilder
            {
                Host = "127.0.0.1",
                Port = 1,
                Database = "synthetic",
                Username = "synthetic",
                Password = password,
            }.ConnectionString
        );
        using var client = factory.CreateClient();
        using var health = await client.GetAsync("/api/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var ready = await client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        var body = await ready.Content.ReadAsStringAsync(Ct);
        body.ShouldContain("unavailable");
        body.ShouldNotContain(password);
        body.ShouldNotContain("127.0.0.1");
    }

    [Fact]
    public async Task whenSchemaMissing_StartupAndReadinessFlow_ShouldNotRunMigrations()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var factory = new TestApiFactory(Fixture.RuntimeConnection);
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/ready", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        await using var check = Fixture.Admin.CreateCommand(
            "SELECT to_regclass('penny.schema_version') IS NULL"
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(true);
    }

    [Fact]
    public async Task whenRuntimeRoleUsed_DatabaseWrites_ShouldRejectMigrationsAndMetadataUpdates()
    {
        var runtime = Fixture.Factory.Services.GetRequiredService<NpgsqlDataSource>();
        var error = await Should.ThrowAsync<PostgresException>(() =>
            DatabaseMigrator.ApplyAsync(runtime, Ct)
        );
        error.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
        await using var update = runtime.CreateCommand("UPDATE penny.schema_version SET version=2");
        var denied = await Should.ThrowAsync<PostgresException>(() =>
            update.ExecuteNonQueryAsync(Ct)
        );
        denied.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
    }
}
