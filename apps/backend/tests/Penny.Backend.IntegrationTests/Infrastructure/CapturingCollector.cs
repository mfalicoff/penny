using System.Net;
using System.Threading.Channels;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// MAZ-129: stands in for the telemetry collector behind the API. It is installed as the
// forwarder's HTTP handler, so the API's own outgoing request is captured as sent.
public sealed class CapturingCollector : HttpMessageHandler
{
    private readonly Channel<Captured> received = Channel.CreateUnbounded<Captured>();

    public sealed record Captured(
        Uri Url,
        IReadOnlyDictionary<string, string> Headers,
        string Body
    );

    public HttpStatusCode Status { get; set; } = HttpStatusCode.Accepted;

    public int Count => received.Reader.Count;

    public async Task<Captured> NextAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        return await received.Reader.ReadAsync(timeout.Token);
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        var headers = request
            .Headers.Concat(
                request.Content?.Headers
                    ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>()
            )
            .ToDictionary(
                header => header.Key,
                header => string.Join(",", header.Value),
                StringComparer.OrdinalIgnoreCase
            );
        var body = request.Content is null
            ? ""
            : await request.Content.ReadAsStringAsync(cancellationToken);
        await received.Writer.WriteAsync(
            new Captured(request.RequestUri!, headers, body),
            cancellationToken
        );
        return new HttpResponseMessage(Status);
    }
}
