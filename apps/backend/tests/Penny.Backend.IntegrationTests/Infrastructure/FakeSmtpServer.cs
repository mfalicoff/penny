using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using MimeKit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A local SMTP server for the email suites (MAZ-124): plain text on loopback, enough of
// RFC 5321 for MailKit (EHLO, MAIL, RCPT, DATA, RSET, NOOP, QUIT). It records every
// accepted message and can refuse the next messages with a chosen reply, or drop
// connections before the greeting, so tests drive retries and permanent failures.
public sealed class FakeSmtpServer : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentQueue<string> replies = new();
    private readonly Task accepting;

    public FakeSmtpServer()
    {
        listener.Start();
        accepting = AcceptAsync();
    }

    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    public ConcurrentQueue<(string Recipient, MimeMessage Message)> Received { get; } = new();

    // While true, connections close before the greeting (a server that is down).
    public bool Down { get; set; }

    // The next `count` messages get `reply` (such as `451 4.3.0 Try later`) after DATA.
    public void Refuse(int count, string reply)
    {
        for (var index = 0; index < count; index++)
            replies.Enqueue(reply);
    }

    public IReadOnlyList<(string Recipient, MimeMessage Message)> To(string recipient) =>
        [.. Received.Where(item => string.Equals(item.Recipient, recipient, StringComparison.Ordinal))];

    public async ValueTask DisposeAsync()
    {
        await stopping.CancelAsync();
        listener.Stop();
        try
        {
            await accepting;
        }
        catch (OperationCanceledException) { }
        stopping.Dispose();
    }

    private async Task AcceptAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(stopping.Token);
            }
            catch (Exception error) when (error is OperationCanceledException or SocketException or ObjectDisposedException)
            {
                return;
            }
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using var _ = client;
        if (Down)
            return;
        try
        {
            var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII);
            await using var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };
            await writer.WriteLineAsync("220 fake.test ESMTP");
            string? recipient = null;
            while (await reader.ReadLineAsync(stopping.Token) is { } line)
            {
                var verb = line.Split(' ', 2)[0].ToUpperInvariant();
                switch (verb)
                {
                    case "EHLO":
                        await writer.WriteLineAsync("250-fake.test");
                        await writer.WriteLineAsync("250 8BITMIME");
                        break;
                    case "HELO":
                    case "NOOP":
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "RSET":
                        recipient = null;
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "MAIL":
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "RCPT":
                        var start = line.IndexOf('<', StringComparison.Ordinal);
                        var end = line.IndexOf('>', StringComparison.Ordinal);
                        recipient = line[(start + 1)..end];
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "DATA":
                        await writer.WriteLineAsync("354 End data with <CR><LF>.<CR><LF>");
                        var data = new StringBuilder();
                        while (await reader.ReadLineAsync(stopping.Token) is { } dataLine && dataLine != ".")
                            data.Append(dataLine.StartsWith("..", StringComparison.Ordinal) ? dataLine[1..] : dataLine).Append("\r\n");
                        if (replies.TryDequeue(out var refusal))
                        {
                            await writer.WriteLineAsync(refusal);
                            break;
                        }
                        using (var bytes = new MemoryStream(Encoding.UTF8.GetBytes(data.ToString())))
                            Received.Enqueue((recipient ?? "", await MimeMessage.LoadAsync(bytes, stopping.Token)));
                        await writer.WriteLineAsync("250 OK queued");
                        break;
                    case "QUIT":
                        await writer.WriteLineAsync("221 Bye");
                        return;
                    default:
                        await writer.WriteLineAsync("502 Not implemented");
                        break;
                }
            }
        }
        catch (Exception error) when (error is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
    }
}
