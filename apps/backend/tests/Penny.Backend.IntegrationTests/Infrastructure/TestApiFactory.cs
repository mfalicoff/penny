using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;

namespace Penny.Backend.IntegrationTests.Infrastructure;

public sealed class TestApiFactory(
    string connectionString,
    IReadOnlyDictionary<string, string>? settings = null
) : WebApplicationFactory<Program>
{
    public TestClock Clock { get; } = new();

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
        // Production-like cookies; the shared host must not exhaust the sign-in limit
        // across tests, so rate-limit tests use their own host with the legacy 40.
        builder.UseSetting("Auth:SecureCookies", "true");
        builder.UseSetting("Auth:RateLimitPermits", "10000");
        foreach (var (key, value) in settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(Clock);
            services.AddSingleton<ProbeSignals>();
            services.AddControllers().AddApplicationPart(typeof(BoundaryProbeController).Assembly);
        });
    }
}
