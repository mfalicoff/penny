using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Errors;
using Penny.Backend.Api.Middleware;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Health;

namespace Penny.Backend.Api.Configuration;

public static class BackendServices
{
    public static void AddBackendServices(this WebApplicationBuilder builder)
    {
        var configuration = builder.Configuration;
        var options = BackendOptions.Read(configuration);
        var database = DatabaseSettings.Create(
            configuration.GetConnectionString("Postgres"),
            BackendOptions.ReadBounded(configuration, "Database:MaxPoolSize", 20, 1, 100),
            BackendOptions.ReadBounded(configuration, "Database:ConnectTimeoutSeconds", 5, 1, 30),
            BackendOptions.ReadBounded(configuration, "Database:CommandTimeoutSeconds", 5, 1, 30)
        );
        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton(_ => database.CreateDataSource());
        builder.Services.AddSingleton<IStorageReadiness, PostgresReadiness>();
        builder.Services.Configure<ApiBehaviorOptions>(api =>
            api.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(
                new ApiError("Invalid request.")
            )
        );
        builder.Services.Configure<HostOptions>(host =>
            host.ShutdownTimeout = TimeSpan.FromSeconds(options.ShutdownTimeoutSeconds)
        );
        builder.WebHost.ConfigureKestrel(server =>
            server.Limits.MaxRequestBodySize = options.MaxRequestBodyBytes
        );
        builder.Services.AddRequestTimeouts(timeouts =>
            timeouts.DefaultPolicy = new RequestTimeoutPolicy
            {
                Timeout = TimeSpan.FromSeconds(options.RequestTimeoutSeconds),
                TimeoutStatusCode = 503,
                WriteTimeoutResponse = context =>
                {
                    context.Response.Headers.RetryAfter = "5";
                    var clientCancellation = (CancellationToken)
                        context.Items[ApiBoundaryMiddleware.ClientCancellation]!;
                    return ApiErrors.WriteAsync(
                        context,
                        503,
                        "The request timed out. Please retry.",
                        clientCancellation
                    );
                },
            }
        );
        builder.Services.AddOpenApi();
    }
}
