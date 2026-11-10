using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// MAZ-127: in-memory exporters next to the host's real OTLP exporter, so tests see
// exactly the spans, metric points and log records the collector would receive
// (after every processor, including the redacting one).
public sealed class TelemetryCapture
{
    public List<Activity> Spans { get; } = [];
    public List<MetricSnapshot> Metrics { get; } = [];
    public ConcurrentQueue<CapturedLog> Logs { get; } = new();

    // Host settings that turn telemetry on, pointed at `endpoint` (a collector that
    // never answers), with information logs flowing.
    public static Dictionary<string, string> Settings(string endpoint) =>
        new()
        {
            ["OTEL_EXPORTER_OTLP_ENDPOINT"] = endpoint,
            ["OTEL_EXPORTER_OTLP_TIMEOUT"] = "1000",
            ["OTEL_SERVICE_NAME"] = "penny-backend-tests",
            ["Logging:LogLevel:Default"] = "Information",
            ["Logging:LogLevel:Microsoft.AspNetCore"] = "Warning",
            ["Logging:LogLevel:Microsoft.EntityFrameworkCore"] = "Warning",
        };

    public void Configure(IServiceCollection services)
    {
        services.ConfigureOpenTelemetryTracerProvider(tracing =>
            tracing.AddInMemoryExporter(Spans)
        );
        services.ConfigureOpenTelemetryMeterProvider(metrics =>
            metrics.AddInMemoryExporter(Metrics)
        );
        services.ConfigureOpenTelemetryLoggerProvider(logging =>
            logging.AddProcessor(new LogSnapshotProcessor(Logs))
        );
    }

    public static void Flush(IServiceProvider services)
    {
        services.GetRequiredService<TracerProvider>().ForceFlush();
        services.GetRequiredService<MeterProvider>().ForceFlush();
        services.GetRequiredService<LoggerProvider>().ForceFlush();
    }

    public IEnumerable<string> MetricNames => Metrics.Select(metric => metric.Name).Distinct();

    // Every point's attributes of one metric, as dictionaries.
    public IEnumerable<Dictionary<string, object?>> Points(string name) =>
        Metrics
            .Where(metric => metric.Name == name)
            .SelectMany(metric => metric.MetricPoints)
            .Select(point =>
            {
                var tags = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var tag in point.Tags)
                    tags[tag.Key] = tag.Value;
                return tags;
            });

    // All exported text: span names, attributes, events, links and status; metric
    // names, units and attributes; log bodies, messages, attributes, scopes and
    // exceptions. Sensitive-value assertions run over this.
    public IEnumerable<string> Text()
    {
        foreach (var span in Spans)
        {
            yield return span.DisplayName;
            yield return span.OperationName;
            yield return span.StatusDescription ?? "";
            foreach (var tag in span.TagObjects)
                yield return $"{tag.Key}={Format(tag.Value)}";
            foreach (var item in span.Baggage)
                yield return $"{item.Key}={item.Value}";
            foreach (var spanEvent in span.Events)
            {
                yield return spanEvent.Name;
                foreach (var tag in spanEvent.Tags)
                    yield return $"{tag.Key}={Format(tag.Value)}";
            }
        }
        foreach (var metric in Metrics)
        {
            yield return metric.Name;
            yield return metric.Unit;
            foreach (var point in metric.MetricPoints)
            foreach (var tag in point.Tags)
                yield return $"{tag.Key}={Format(tag.Value)}";
        }
        foreach (var log in Logs)
        foreach (var text in log.Text)
            yield return text;
    }

    private static string Format(object? value) =>
        value switch
        {
            null => "",
            string text => text,
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            System.Collections.IEnumerable items => string.Join(
                ",",
                items.Cast<object?>().Select(Format)
            ),
            _ => value.ToString() ?? "",
        };

    // A copy of one log record taken when it is emitted: the SDK pools records.
    public sealed record CapturedLog(
        string Category,
        string? Message,
        ActivityTraceId TraceId,
        IReadOnlyList<string> Text
    );

    private sealed class LogSnapshotProcessor(ConcurrentQueue<CapturedLog> logs)
        : BaseProcessor<LogRecord>
    {
        public override void OnEnd(LogRecord data)
        {
            var text = new List<string>
            {
                data.CategoryName ?? "",
                data.FormattedMessage ?? "",
                data.Body ?? "",
                data.Exception?.ToString() ?? "",
            };
            foreach (var attribute in data.Attributes ?? [])
                text.Add($"{attribute.Key}={Format(attribute.Value)}");
            data.ForEachScope(
                (scope, state) =>
                {
                    foreach (var item in scope)
                        state.Add($"{item.Key}={Format(item.Value)}");
                },
                text
            );
            logs.Enqueue(
                new CapturedLog(data.CategoryName ?? "", data.FormattedMessage, data.TraceId, text)
            );
        }
    }
}
