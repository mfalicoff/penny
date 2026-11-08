using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;

namespace Penny.Backend.IntegrationTests.Infrastructure;

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
