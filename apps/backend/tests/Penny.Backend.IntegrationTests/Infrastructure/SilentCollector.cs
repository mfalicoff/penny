using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// An OTLP "collector" that accepts connections and never answers: the worst case for
// an exporter (no refusal to fail fast on). Requests must not notice it.
public sealed class SilentCollector : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly ConcurrentBag<TcpClient> held = [];
    private readonly CancellationTokenSource stopping = new();
    private readonly Task accepting;

    public SilentCollector()
    {
        listener.Start();
        accepting = AcceptAsync();
    }

    public string Endpoint => $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}";

    public int Connections => held.Count;

    private async Task AcceptAsync()
    {
        try
        {
            while (!stopping.IsCancellationRequested)
                held.Add(await listener.AcceptTcpClientAsync(stopping.Token));
        }
        catch (OperationCanceledException) { }
        catch (SocketException) { }
    }

    public async ValueTask DisposeAsync()
    {
        await stopping.CancelAsync();
        listener.Stop();
        await accepting;
        foreach (var client in held)
            client.Dispose();
        stopping.Dispose();
    }
}
