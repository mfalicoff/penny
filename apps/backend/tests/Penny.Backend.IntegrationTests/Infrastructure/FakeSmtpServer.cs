using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using MimeKit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A local SMTP server for the email suites (MAZ-124) on loopback, enough of RFC 5321 for
// MailKit (EHLO, MAIL, RCPT, DATA, RSET, NOOP, QUIT): plain text, implicit TLS (as on
// port 465) or STARTTLS (as on 587) with a throwaway self-signed certificate, and AUTH
// PLAIN or LOGIN once secure. It records every
// accepted message and can refuse the next messages with a chosen reply, or drop
// connections before the greeting, so tests drive retries and permanent failures.
public sealed class FakeSmtpServer : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentQueue<string> replies = new();
    private readonly Task accepting;

    public FakeSmtpServer(FakeSmtpTls tls = FakeSmtpTls.None)
    {
        Tls = tls;
        if (tls != FakeSmtpTls.None)
            Certificate = SelfSigned();
        listener.Start();
        accepting = AcceptAsync();
    }

    public FakeSmtpTls Tls { get; }

    // The server certificate, which tests pin (it is never trusted by the platform).
    public X509Certificate2? Certificate { get; }

    // Credentials clients authenticated with.
    public ConcurrentQueue<(string User, string Password)> Credentials { get; } = new();

    // Trusts exactly this server's certificate.
    public bool IsServerCertificate(X509Certificate? certificate) =>
        Certificate is not null
        && certificate is not null
        && certificate.GetCertHashString(HashAlgorithmName.SHA256)
            == Certificate.GetCertHashString(HashAlgorithmName.SHA256);

    private static X509Certificate2 SelfSigned()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=localhost",
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1
        );
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName("localhost");
        names.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(names.Build());
        using var created = request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-5),
            DateTimeOffset.UtcNow.AddDays(1)
        );
        // Through PKCS#12 so the private key is usable by SslStream on every platform.
        return X509CertificateLoader.LoadPkcs12(created.Export(X509ContentType.Pkcs12), null);
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

    // Forgets received messages and pending refusals and comes back up (between tests).
    public void Reset()
    {
        Received.Clear();
        Credentials.Clear();
        replies.Clear();
        Down = false;
    }

    public IReadOnlyList<(string Recipient, MimeMessage Message)> To(string recipient) =>
        [
            .. Received.Where(item =>
                string.Equals(item.Recipient, recipient, StringComparison.Ordinal)
            ),
        ];

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
        Certificate?.Dispose();
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
            catch (Exception error)
                when (error
                        is OperationCanceledException
                            or SocketException
                            or ObjectDisposedException
                )
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
            Stream stream = client.GetStream();
            if (Tls == FakeSmtpTls.Implicit)
                stream = await SecureAsync(stream);
            var (reader, writer) = Open(stream);
            await writer.WriteLineAsync("220 fake.test ESMTP");
            var secure = Tls == FakeSmtpTls.Implicit;
            string? recipient = null;
            while (await reader.ReadLineAsync(stopping.Token) is { } line)
            {
                var verb = line.Split(' ', 2)[0].ToUpperInvariant();
                switch (verb)
                {
                    case "EHLO":
                        await writer.WriteLineAsync("250-fake.test");
                        if (Tls == FakeSmtpTls.StartTls && !secure)
                            await writer.WriteLineAsync("250-STARTTLS");
                        if (secure)
                            await writer.WriteLineAsync("250-AUTH PLAIN LOGIN");
                        await writer.WriteLineAsync("250 8BITMIME");
                        break;
                    case "STARTTLS" when Tls == FakeSmtpTls.StartTls && !secure:
                        await writer.WriteLineAsync("220 Ready to start TLS");
                        stream = await SecureAsync(stream);
                        (reader, writer) = Open(stream);
                        secure = true;
                        break;
                    case "AUTH" when secure:
                        await AuthenticateAsync(line, reader, writer);
                        break;
                    case "HELO":
                    case "NOOP":
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "RSET":
                        recipient = null;
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "MAIL" when Tls != FakeSmtpTls.None && !secure:
                        await writer.WriteLineAsync(
                            "530 5.7.0 Must issue a STARTTLS command first"
                        );
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
                        while (
                            await reader.ReadLineAsync(stopping.Token) is { } dataLine
                            && dataLine != "."
                        )
                            data.Append(
                                    dataLine.StartsWith("..", StringComparison.Ordinal)
                                        ? dataLine[1..]
                                        : dataLine
                                )
                                .Append("\r\n");
                        if (replies.TryDequeue(out var refusal))
                        {
                            await writer.WriteLineAsync(refusal);
                            break;
                        }
                        using (
                            var bytes = new MemoryStream(Encoding.UTF8.GetBytes(data.ToString()))
                        )
                            Received.Enqueue(
                                (
                                    recipient ?? "",
                                    await MimeMessage.LoadAsync(bytes, stopping.Token)
                                )
                            );
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
        catch (Exception error)
            when (error
                    is IOException
                        or SocketException
                        or OperationCanceledException
                        or ObjectDisposedException
                        or System.Security.Authentication.AuthenticationException
            ) { }
    }

    // AUTH PLAIN (with or without an initial response) and AUTH LOGIN; records the
    // credentials and accepts them.
    private async Task AuthenticateAsync(string line, StreamReader reader, StreamWriter writer)
    {
        var parts = line.Split(' ');
        var mechanism = parts.Length > 1 ? parts[1].ToUpperInvariant() : "";
        static string Decode(string value) =>
            Encoding.UTF8.GetString(Convert.FromBase64String(value));
        if (mechanism == "PLAIN")
        {
            var response = parts.Length > 2 ? parts[2] : null;
            if (response is null)
            {
                await writer.WriteLineAsync("334 ");
                response = await reader.ReadLineAsync(stopping.Token) ?? "";
            }
            var fields = Decode(response).Split('\0');
            Credentials.Enqueue((fields[1], fields[2]));
        }
        else if (mechanism == "LOGIN")
        {
            await writer.WriteLineAsync("334 VXNlcm5hbWU6");
            var user = Decode(await reader.ReadLineAsync(stopping.Token) ?? "");
            await writer.WriteLineAsync("334 UGFzc3dvcmQ6");
            var password = Decode(await reader.ReadLineAsync(stopping.Token) ?? "");
            Credentials.Enqueue((user, password));
        }
        else
        {
            await writer.WriteLineAsync("504 Unrecognized authentication type");
            return;
        }
        await writer.WriteLineAsync("235 2.7.0 Authentication successful");
    }

    private async Task<Stream> SecureAsync(Stream stream)
    {
        var secure = new SslStream(stream, leaveInnerStreamOpen: false);
        await secure.AuthenticateAsServerAsync(Certificate!, false, false);
        return secure;
    }

    private static (StreamReader, StreamWriter) Open(Stream stream) =>
        (
            new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true),
            new StreamWriter(stream, Encoding.ASCII, 1024, leaveOpen: true)
            {
                NewLine = "\r\n",
                AutoFlush = true,
            }
        );
}
