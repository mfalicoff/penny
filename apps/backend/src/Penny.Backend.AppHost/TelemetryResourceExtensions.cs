using Aspire.Hosting.ApplicationModel;

namespace Penny.Backend.AppHost;

public static class TelemetryResourceExtensions
{
    // Aspire points every project at its own dashboard's OTLP endpoint. Penny sends its
    // telemetry to Alloy instead (one copy, viewed in Grafana), so this drops the OTEL_*
    // variables Aspire added. Settings added after this call are kept.
    public static IResourceBuilder<T> WithoutAspireTelemetry<T>(this IResourceBuilder<T> builder)
        where T : IResourceWithEnvironment =>
        builder.WithEnvironment(context =>
        {
            foreach (
                var key in context
                    .EnvironmentVariables.Keys.Where(key =>
                        key.StartsWith("OTEL_", StringComparison.Ordinal)
                    )
                    .ToList()
            )
                context.EnvironmentVariables.Remove(key);
        });
}
