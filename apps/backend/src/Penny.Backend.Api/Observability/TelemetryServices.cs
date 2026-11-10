using System.Reflection;
using Npgsql;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Api.Observability;

// MAZ-127: traces, metrics and logs over OTLP, only when an endpoint is configured
// (TelemetryOptions). Otherwise nothing is registered and the host behaves exactly
// as before. Export is batched in the background, so a slow or unreachable collector
// never delays or fails a request; the exporter drops what it cannot send.
public static class TelemetryServices
{
    public static TelemetryOptions AddBackendTelemetry(this WebApplicationBuilder builder)
    {
        var options = TelemetryOptions.Read(builder.Configuration);
        builder.Services.AddSingleton(options);
        if (!options.Enabled)
            return options;
        var version =
            typeof(TelemetryServices)
                .Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion.Split('+')[0]
            ?? "unknown";
        builder
            .Services.AddOpenTelemetry()
            .ConfigureResource(resource =>
                resource.AddService(options.ServiceName, serviceVersion: version)
            )
            .WithTracing(tracing =>
                tracing
                    .AddSource(BackendTelemetry.Name)
                    .AddAspNetCoreInstrumentation(aspNetCore =>
                    {
                        // Liveness and readiness probes poll constantly; their metrics
                        // remain, their spans (and SQL) are not recorded.
                        aspNetCore.Filter = context =>
                            !context.Request.Path.StartsWithSegments("/api/health")
                            && !context.Request.Path.StartsWithSegments("/api/ready");
                        aspNetCore.RecordException = false;
                    })
                    .AddHttpClientInstrumentation(http => http.RecordException = false)
                    .AddNpgsql()
                    .AddProcessor(new RedactingSpanProcessor())
            )
            .WithMetrics(metrics =>
                metrics
                    .AddMeter(BackendTelemetry.Name)
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation()
                    .AddNpgsqlInstrumentation()
            )
            .WithLogging(
                _ => { },
                logging =>
                {
                    // The same structured ILogger records as the console, with the
                    // request scope (RequestId); trace and span ids are attached.
                    logging.IncludeScopes = true;
                    logging.IncludeFormattedMessage = true;
                }
            )
            .UseOtlpExporter();
        return options;
    }
}
