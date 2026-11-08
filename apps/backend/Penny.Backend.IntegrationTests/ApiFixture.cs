using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Penny.Backend.IntegrationTests;

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "postgres-api";
}

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
        Factory = new TestApiFactory(RuntimeConnection);
        Factory.UseKestrel(0);
        Factory.StartServer();
    }

    public Task GrantRuntimeAsync(CancellationToken ct) =>
        SqlAsync(
            """
            GRANT CONNECT ON DATABASE penny_tests TO penny_runtime;
            GRANT USAGE ON SCHEMA penny TO penny_runtime;
            GRANT SELECT ON penny.schema_version TO penny_runtime;
            """,
            ct
        );

    public async Task SqlAsync(string sql, CancellationToken ct)
    {
        await using var command = Admin.CreateCommand(sql);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task ResetAsync(CancellationToken ct)
    {
        // There are no product tables yet. Restore only compatibility metadata.
        // MAZ-52's product schema will add Respawn, preserving migration history.
        await SqlAsync(
            """
            CREATE SCHEMA IF NOT EXISTS penny;
            CREATE TABLE IF NOT EXISTS penny.schema_version(singleton boolean PRIMARY KEY DEFAULT TRUE CHECK(singleton), version integer NOT NULL CHECK(version > 0));
            INSERT INTO penny.schema_version VALUES(TRUE, 1) ON CONFLICT(singleton) DO UPDATE SET version = 1;
            CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
            REVOKE CREATE ON SCHEMA penny, public FROM penny_runtime;
            REVOKE CREATE ON DATABASE penny_tests FROM penny_runtime;
            """,
            ct
        );
        await GrantRuntimeAsync(ct);
        Factory.Services.GetRequiredService<ProbeSignals>().Reset();
    }

    public async ValueTask DisposeAsync()
    {
        if (Factory is not null)
            await Factory.DisposeAsync();
        if (Admin is not null)
            await Admin.DisposeAsync();
        await postgres.DisposeAsync();
    }
}

public sealed class TestApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Postgres", connectionString);
        builder.UseSetting("Database:ConnectTimeoutSeconds", "1");
        builder.UseSetting("Database:CommandTimeoutSeconds", "1");
        builder.UseSetting("Backend:MaxRequestBodyBytes", "256");
        builder.UseSetting("Backend:RequestTimeoutSeconds", "2");
        builder.UseSetting("Backend:ShutdownTimeoutSeconds", "5");
        builder.UseSetting("Logging:LogLevel:Default", "None");
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ProbeSignals>();
            services.AddControllers().AddApplicationPart(typeof(BoundaryProbeController).Assembly);
        });
    }
}

[Collection(ApiCollection.Name)]
public abstract class IntegrationTestBase(ApiFixture fixture) : IAsyncLifetime
{
    protected ApiFixture Fixture { get; } = fixture;
    protected HttpClient Client { get; private set; } = null!;
    protected static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await Fixture.ResetAsync(Ct);
        Client = Fixture.Factory.CreateClient();
    }

    public ValueTask DisposeAsync()
    {
        Client.Dispose();
        return ValueTask.CompletedTask;
    }
}
