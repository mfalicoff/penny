using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;

namespace Penny.Backend.IntegrationTests.Infrastructure;

public sealed class TestApiFactory(
    string connectionString,
    IReadOnlyDictionary<string, string>? settings = null,
    Action<IServiceCollection>? services = null
) : WebApplicationFactory<Program>
{
    public const int MaxBodyBytes = 65536;

    public TestClock Clock { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Postgres", connectionString);
        builder.UseSetting("Database:ConnectTimeoutSeconds", "1");
        builder.UseSetting("Database:CommandTimeoutSeconds", "1");
        // Small enough for chunked/known-length 413 tests, large enough for ledgers.
        builder.UseSetting(
            "Backend:MaxRequestBodyBytes",
            MaxBodyBytes.ToString(CultureInfo.InvariantCulture)
        );
        // Hosts that never touch receipts get an unused root and a throwaway key.
        builder.UseSetting(
            "Receipts:Root",
            Path.Combine(Path.GetTempPath(), "penny-receipts-unused")
        );
        builder.UseSetting(
            "Receipts:MasterKey",
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        );
        // The real pinned model, shared by every host in the process.
        builder.UseSetting("Search:ModelDirectory", SearchModel.Directory);
        // Tests drive the embedding outbox explicitly; worker tests start their own host.
        builder.UseSetting("Search:EmbeddingWorker", "false");
        builder.UseSetting("Search:RateLimitPermits", "10000");
        builder.UseSetting("Backend:RequestTimeoutSeconds", "2");
        builder.UseSetting("Backend:ShutdownTimeoutSeconds", "5");
        builder.UseSetting("Logging:LogLevel:Default", "None");
        // Production-like cookies; the shared host must not exhaust the sign-in limit
        // or invite limits across tests, so rate-limit tests use their own host.
        builder.UseSetting("Auth:SecureCookies", "true");
        builder.UseSetting("Auth:RateLimitPermits", "10000");
        builder.UseSetting("Auth:InviteRateLimitPermits", "10000");
        foreach (var (key, value) in settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
        builder.ConfigureTestServices(collection =>
        {
            collection.AddSingleton<TimeProvider>(Clock);
            collection.AddSingleton<ProbeSignals>();
            collection
                .AddControllers()
                .AddApplicationPart(typeof(BoundaryProbeController).Assembly);
            services?.Invoke(collection);
        });
    }
}
