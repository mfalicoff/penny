# Test harness: fixtures, factory, auth, reset

Contents: 1. Project file · 2. Making the app host-able · 3. The factory · 4. The fixture · 5. Collection vs assembly fixtures · 6. Base class · 7. Test auth · 8. Outbound HTTP and other boundaries · 9. SQL Server variant · 10. CI and environment

## 1. Project file

xUnit v3 test projects are executables. Use Central Package Management (`Directory.Packages.props`) and add packages with `dotnet add package` so versions are current.

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
    <PackageReference Include="Testcontainers.PostgreSql" />
    <PackageReference Include="Respawn" />
    <PackageReference Include="Shouldly" />
    <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" />
    <PackageReference Include="Bogus" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\Ordering.Api\Ordering.Api.csproj" />
  </ItemGroup>
</Project>
```

Referencing the web project also brings the ASP.NET Core shared framework, so types like `HttpValidationProblemDetails` are available in tests.

## 2. Making the app host-able

```csharp
// end of Program.cs in the API project
public partial class Program;
```

Register the DbContext so the connection string is resolved at service-resolution time, which lets tests override configuration cleanly:

```csharp
services.AddDbContext<AppDbContext>((sp, options) =>
    options.UseNpgsql(sp.GetRequiredService<IConfiguration>().GetConnectionString("Default")));
```

Do not call `Database.Migrate()` in the app's startup path for the code under test; the fixture migrates explicitly (section 4). If production needs auto-migration, gate it behind a setting that is off in tests.

## 3. The factory

Override configuration with `UseSetting` (visible to eager reads in `Program.cs`) and replace only boundary services with `ConfigureTestServices`, which runs after the app's own registrations.

```csharp
public sealed class TestApiFactory(string connectionString, FakeTimeProvider time)
    : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Default", connectionString);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(time);

            services.Configure<AuthenticationOptions>(o =>
            {
                o.DefaultAuthenticateScheme = TestAuthHandler.Scheme;
                o.DefaultChallengeScheme = TestAuthHandler.Scheme;
            });
            services.AddAuthentication()
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
        });
    }
}
```

The factory's default environment is `Development`, which keeps OpenAPI/Scalar mapped if the app gates them on `IsDevelopment()`. For tests that need production behavior (for example, no exception details in ProblemDetails), derive a client from `Factory.WithWebHostBuilder(b => b.UseEnvironment("Production"))`.

## 4. The fixture

Composition (the fixture owns a container and a factory) avoids the `DisposeAsync` ambiguity you get when a class inherits `WebApplicationFactory` and also implements xUnit's `IAsyncLifetime`.

```csharp
public sealed class ApiFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres =
        new PostgreSqlBuilder("postgres:17-alpine")   // pin the major version production runs
            .WithDatabase("app_tests")
            .Build();

    private Respawner _respawner = null!;

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 1, 15, 12, 0, 0, TimeSpan.Zero));
    public TestApiFactory Factory { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();
        var cs = _postgres.GetConnectionString();

        Factory = new TestApiFactory(cs, Time);

        // Touching Services builds the host; then migrate once for the whole run.
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.MigrateAsync();
        }

        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = [new Table("__EFMigrationsHistory")],
        });
    }

    public async Task ResetDatabaseAsync()
    {
        await using var conn = new NpgsqlConnection(_postgres.GetConnectionString());
        await conn.OpenAsync();
        await _respawner.ResetAsync(conn);
    }

    public async ValueTask DisposeAsync()
    {
        await Factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}
```

Notes:

- Older Testcontainers versions use `new PostgreSqlBuilder().WithImage("postgres:17-alpine")`; newer ones take the image in the constructor. Follow whichever the installed version accepts without an obsolete warning.
- Reference data seeded by migrations (lookup tables) must be excluded in `TablesToIgnore`, or re-seeded after reset.
- If the schema is large and migrations are slow, build the schema once and reuse it; do not recreate containers.
- `WithReuse(true)` can speed up local inner-loop runs but makes state leak between runs; do not enable it in CI.

## 5. Collection vs assembly fixtures

**Single collection (default recommendation).** All integration test classes join one collection, so they share one container and run serially, which makes Respawn-per-test safe.

```csharp
[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "api";
}
```

**Assembly fixture (xUnit v3).** Use when you want the fixture injected without a collection attribute:

```csharp
[assembly: AssemblyFixture(typeof(ApiFixture))]
[assembly: CollectionBehavior(DisableTestParallelization = true)]
```

Classes then take `ApiFixture` in their constructor. Because assembly fixtures do not serialize classes by themselves, you must either disable parallelization (as above) or give each test isolated data (unique tenant/customer IDs) and skip the global reset. Pick one strategy; mixing them is the main source of flaky integration suites.

**Faster alternative when the suite gets large:** keep parallelism and give each collection its own database inside the same container (create a database per collection from a migrated template database), each with its own Respawner. This is worth it only when serial runtime becomes a real problem.

## 6. Base class

```csharp
[Collection(ApiCollection.Name)]
public abstract class IntegrationTestBase(ApiFixture fixture) : IAsyncLifetime
{
    protected ApiFixture Fixture { get; } = fixture;
    protected HttpClient Client { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        await Fixture.ResetDatabaseAsync();
        Fixture.Time.SetUtcNow(new DateTimeOffset(2026, 1, 15, 12, 0, 0, TimeSpan.Zero));
        Client = Fixture.Factory.CreateClient();
    }

    public ValueTask DisposeAsync()
    {
        Client.Dispose();
        return ValueTask.CompletedTask;
    }

    protected HttpClient CreateClientFor(string userId, params string[] roles)
    {
        var client = Fixture.Factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        if (roles.Length > 0)
            client.DefaultRequestHeaders.Add(TestAuthHandler.RolesHeader, string.Join(',', roles));
        return client;
    }

    protected async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = Fixture.Factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    protected Task WithDbAsync(Func<AppDbContext, Task> action) =>
        WithDbAsync<object?>(async db => { await action(db); return null; });
}
```

Reading and seeding through a fresh scope (a new `DbContext` each time) avoids stale change-tracker state hiding persistence bugs.

## 7. Test auth

Replacing real JWT validation with a header-driven handler keeps tests independent of an identity provider while still running the real authorization policies.

```csharp
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "Test";
    public const string UserHeader = "X-Test-User";
    public const string RolesHeader = "X-Test-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserHeader, out var user))
            return Task.FromResult(AuthenticateResult.NoResult());   // yields 401 on protected endpoints

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.ToString()),
            new(ClaimTypes.Name, user.ToString()),
        };
        if (Request.Headers.TryGetValue(RolesHeader, out var roles))
            claims.AddRange(roles.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(r => new Claim(ClaimTypes.Role, r)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme)));
    }
}
```

Add one separate test (or a small set) that exercises the real JWT/OIDC configuration if misconfiguration there is a real risk; the test handler deliberately skips it.

## 8. Outbound HTTP and other boundaries

Stub at the network edge so serialization, `HttpClient` config and retry policies stay under test:

- **WireMock.Net**: start a `WireMockServer` in the fixture and point the typed client's base address at it with `UseSetting("Payments:BaseUrl", server.Url)`. Reset mappings per test.
- **Message brokers / email**: prefer a Testcontainers broker (RabbitMQ, Kafka) when the messaging behavior matters; otherwise replace the publisher interface with an in-memory capture and assert on it.
- Register fakes in `ConfigureTestServices`, never by editing production registrations.

## 9. SQL Server variant

Swap the package and adapter:

```csharp
private readonly MsSqlContainer _db = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-latest").Build();
// ...
await using var conn = new SqlConnection(_db.GetConnectionString());
_respawner = await Respawner.CreateAsync(conn, new RespawnerOptions
{
    DbAdapter = DbAdapter.SqlServer,
    SchemasToInclude = ["dbo"],
    TablesToIgnore = [new Table("__EFMigrationsHistory")],
});
```

SQL Server images are large and slow to start, so the one-container-per-run rule matters even more.

## 10. CI and environment

- GitHub Actions `ubuntu-latest`: Docker is present, so `dotnet test` just works. Cache the NuGet folder; pre-pull the image in a prior step if start time is noisy.
- No Docker daemon (some sandboxes): the tests cannot run there. Say so; do not silently switch to an in-memory provider.
- Rootless Docker/Podman: set `DOCKER_HOST` and, if the reaper (Ryuk) cannot start, `TESTCONTAINERS_RYUK_DISABLED=true`.
- If the .NET 10 SDK is configured to run tests through Microsoft.Testing.Platform (via `global.json`), `dotnet test` behaves slightly differently from VSTest mode; check the repo's existing configuration before changing it.
