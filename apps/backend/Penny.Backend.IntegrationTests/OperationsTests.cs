using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Api;
using Penny.Backend.Persistence;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests;

public sealed class OperationsTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Theory]
    [InlineData("Backend:MaxRequestBodyBytes", "0")]
    [InlineData("Backend:RequestTimeoutSeconds", "infinite")]
    [InlineData("Backend:ShutdownTimeoutSeconds", "301")]
    [InlineData("Database:MaxPoolSize", "101")]
    public async Task Invalid_host_configuration_fails_before_accepting_requests(
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
    public async Task Missing_database_configuration_fails_during_boot()
    {
        await using var factory = new TestApiFactory("");
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("ConnectionStrings__Postgres");
    }

    [Fact]
    public async Task Healthy_restricted_runtime_serves_compatible_health_info_and_readiness()
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
    public async Task Incompatible_database_fails_readiness_but_liveness_survives(
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
    public async Task Unavailable_database_still_boots_and_reports_actionable_readiness_failure()
    {
        // Port 1 is deliberately closed on loopback, not an external service.
        await using var factory = new TestApiFactory(
            "Host=127.0.0.1;Port=1;Database=synthetic;Username=synthetic;Password=never-return-this"
        );
        using var client = factory.CreateClient();
        using var health = await client.GetAsync("/api/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var ready = await client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        var body = await ready.Content.ReadAsStringAsync(Ct);
        body.ShouldContain("unavailable");
        body.ShouldNotContain("never-return-this");
        body.ShouldNotContain("127.0.0.1");
    }

    [Fact]
    public async Task Boot_and_readiness_do_not_create_schema_or_run_migrations()
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
    public async Task Runtime_role_cannot_migrate_or_write_metadata()
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
