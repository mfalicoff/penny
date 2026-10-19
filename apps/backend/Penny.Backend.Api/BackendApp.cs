using Penny.Backend.Application;
using Penny.Backend.Persistence;

namespace Penny.Backend.Api;

public static class BackendApp
{
    public static WebApplication Create(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var options = BackendOptions.Create(
            builder.Configuration["Backend:DataDirectory"],
            builder.Configuration["Backend:MaxRequestBodyBytes"],
            builder.Configuration["Backend:ShutdownTimeoutSeconds"]);

        Directory.CreateDirectory(options.DataDirectory);
        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<IStorageReadiness, DirectoryStorageReadiness>();
        builder.Services.AddSingleton<ReadinessService>();
        builder.Services.Configure<HostOptions>(host =>
            host.ShutdownTimeout = TimeSpan.FromSeconds(options.ShutdownTimeoutSeconds));
        builder.WebHost.ConfigureKestrel(kestrel =>
            kestrel.Limits.MaxRequestBodySize = options.MaxRequestBodyBytes);

        var app = builder.Build();
        app.UseMiddleware<ApiErrorMiddleware>();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            if (context.Request.ContentLength > options.MaxRequestBodyBytes)
            {
                await ApiErrors.WriteAsync(context, 413, "The upload is too large.");
                return;
            }

            await next(context);
            if (!context.Response.HasStarted && context.Response.StatusCode >= 400)
            {
                await ApiErrors.WriteAsync(context, context.Response.StatusCode,
                    context.Response.StatusCode == 404 ? "API route not found." : "The server could not complete this request.");
            }
        });

        app.MapGet("/api/health", () => Results.Json(new { ok = true }));
        app.MapGet("/api/ready", async (ReadinessService readiness, CancellationToken cancellationToken) =>
        {
            var ready = await readiness.IsReadyAsync(cancellationToken);
            return Results.Json(new { ok = ready }, statusCode: ready ? 200 : 503);
        });
        return app;
    }
}
