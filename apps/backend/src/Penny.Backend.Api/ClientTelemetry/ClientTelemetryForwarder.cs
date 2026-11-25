using System.Net.Http.Headers;
using System.Threading.Channels;
using OpenTelemetry;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: sends accepted client telemetry on to the collector in the background. The
// request that posted it has already been answered, so a slow or unreachable collector
// never delays the app: the queue is bounded and drops new reports when full, and a send
// that fails is dropped, not retried (the client already moved on). Outgoing calls are not
// traced, so the collector URL (which can hold a Grafana Cloud key) never appears in spans.
public sealed partial class ClientTelemetryForwarder(
    IHttpClientFactory clients,
    ClientTelemetryOptions options,
    ILogger<ClientTelemetryForwarder> logger
) : BackgroundService
{
    public const string HttpClientName = "client-telemetry";
    private const int Capacity = 256;

    private readonly Channel<Report> queue = Channel.CreateBounded<Report>(
        new BoundedChannelOptions(Capacity)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        }
    );

    public sealed record Report(string Kind, Uri Target, byte[] Body, bool Otlp);

    /// <summary>Queues a report; false when the queue is full and it was dropped.</summary>
    public bool Enqueue(Report report)
    {
        var queued = queue.Writer.TryWrite(report);
        BackendTelemetry.ClientTelemetry(report.Kind, queued ? "accepted" : "dropped");
        return queued;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var client = clients.CreateClient(HttpClientName);
        try
        {
            await foreach (var report in queue.Reader.ReadAllAsync(stoppingToken))
                await SendAsync(client, report, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private async Task SendAsync(
        HttpClient client,
        Report report,
        CancellationToken cancellationToken
    )
    {
        using var suppressed = SuppressInstrumentationScope.Begin();
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, report.Target)
            {
                Content = new ByteArrayContent(report.Body),
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            if (report.Otlp)
                foreach (var (name, value) in options.OtlpHeaders)
                    request.Headers.TryAddWithoutValidation(name, value);
            using var response = await client.SendAsync(request, cancellationToken);
            var outcome = response.IsSuccessStatusCode ? "forwarded" : "refused";
            BackendTelemetry.ClientTelemetry(report.Kind, outcome);
            if (!response.IsSuccessStatusCode)
                LogRefused(logger, report.Kind, (int)response.StatusCode);
        }
        catch (Exception error)
            when ((error is HttpRequestException or TaskCanceledException)
                && !cancellationToken.IsCancellationRequested
            )
        {
            BackendTelemetry.ClientTelemetry(report.Kind, "failed");
            LogUnreachable(logger, report.Kind, error.GetType().Name);
        }
    }

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The telemetry collector refused a {Kind} report with HTTP {Status}."
    )]
    private static partial void LogRefused(ILogger logger, string kind, int status);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The telemetry collector could not be reached for a {Kind} report ({Error})."
    )]
    private static partial void LogUnreachable(ILogger logger, string kind, string error);
}
