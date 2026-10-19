using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Controllers;
using Penny.Backend.Application;
using Penny.Backend.Persistence;

namespace Penny.Backend.Api;

public static class BackendApp
{
    public static WebApplication Create(
        string[] args,
        Action<IMvcBuilder>? configureControllers = null
    )
    {
        var builder = WebApplication.CreateBuilder(args);
        var controllers = builder.Services.AddControllers();
        controllers.AddApplicationPart(typeof(OperationsController).Assembly);
        configureControllers?.Invoke(controllers);
        builder.AddBackendServices();

        var app = builder.Build();
        app.UseBackendMiddleware();
        app.MapControllers();
        return app;
    }

    public static WebApplicationBuilder AddBackendServices(this WebApplicationBuilder builder)
    {
        var options = BackendOptions.Create(
            builder.Configuration["Backend:DataDirectory"],
            builder.Configuration["Backend:MaxRequestBodyBytes"],
            builder.Configuration["Backend:ShutdownTimeoutSeconds"]
        );

        Directory.CreateDirectory(options.DataDirectory);
        builder.Services.Configure<ApiBehaviorOptions>(api =>
            api.InvalidModelStateResponseFactory = _ => new JsonResult(
                new { error = "Invalid request." }
            )
            {
                StatusCode = 400,
            }
        );
        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<IStorageReadiness, DirectoryStorageReadiness>();
        builder.Services.AddSingleton<ReadinessService>();
        builder.Services.Configure<HostOptions>(host =>
            host.ShutdownTimeout = TimeSpan.FromSeconds(options.ShutdownTimeoutSeconds)
        );
        builder.WebHost.ConfigureKestrel(kestrel =>
            kestrel.Limits.MaxRequestBodySize = options.MaxRequestBodyBytes
        );
        return builder;
    }

    public static WebApplication UseBackendMiddleware(this WebApplication app)
    {
        app.UseMiddleware<ApiErrorMiddleware>();
        app.UseMiddleware<ApiPolicyMiddleware>();
        return app;
    }
}
