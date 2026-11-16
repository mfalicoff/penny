using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Penny.Backend.Persistence.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// penny-render as deployed (MAZ-184, doc task 6): the image and flags are read from
// deploy/compose.yaml, the container runs read-only with no capabilities, and it gets
// raw, unsanitized hostile HTML pointing at a canary on the test host. The canary is
// first shown to be reachable from the container (curl), so a quiet canary means
// Chromium itself refused every request: JavaScript is off and every URL but its own
// temporary files is denied. In production the internal `render` network removes the
// route as well.
public sealed class RendererIsolationTests : IAsyncLifetime
{
    private const string CanaryHost = "canary.test";
    private readonly ConcurrentQueue<string> requests = new();
    private readonly CancellationTokenSource stop = new();
    private TcpListener canary = null!;
    private IContainer render = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private int CanaryPort => ((IPEndPoint)canary.LocalEndpoint).Port;

    public async ValueTask InitializeAsync()
    {
        canary = new TcpListener(IPAddress.Any, 0);
        canary.Start();
        _ = Task.Run(AcceptAsync);
        var (image, command) = ComposeService();
        render = new ContainerBuilder(image)
            .WithCommand([.. command])
            .WithPortBinding(3000, true)
            .WithExtraHost(CanaryHost, "host-gateway")
            .WithTmpfsMount("/tmp")
            .WithTmpfsMount("/home/gotenberg")
            .WithCreateParameterModifier(parameters =>
            {
                parameters.HostConfig!.ReadonlyRootfs = true;
                parameters.HostConfig.CapDrop = ["ALL"];
                parameters.HostConfig.SecurityOpt = ["no-new-privileges"];
            })
            .WithWaitStrategy(
                Wait.ForUnixContainer()
                    .UntilHttpRequestIsSucceeded(request =>
                        request.ForPort(3000).ForPath("/health")
                    )
            )
            .Build();
        await render.StartAsync(Ct);
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        canary.Stop();
        if (render is not null)
            await render.DisposeAsync();
        stop.Dispose();
    }

    [Fact]
    public async Task whenHostileHtmlRendered_PennyRender_ShouldNeverOpenAConnection()
    {
        var control = await render.ExecAsync(
            [
                "curl",
                "-s",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                $"http://{CanaryHost}:{CanaryPort}/control",
            ],
            Ct
        );
        control.Stdout.ShouldBe(
            "200",
            "the canary must be reachable from the container: " + control.Stderr
        );
        await WaitForAsync(() => requests.Contains("/control"));

        var url = $"http://{CanaryHost}:{CanaryPort}";
        var hostile = $$"""
            <html><head>
            <link rel="stylesheet" href="{{url}}/link">
            <style>@import url({{url}}/import); body { background: url({{url}}/background) }</style>
            </head><body>
            <p>Visible receipt</p>
            <img src="{{url}}/img"><img src="https://169.254.169.254/latest/meta-data">
            <iframe src="{{url}}/frame"></iframe>
            <object data="{{url}}/object"></object>
            <video poster="{{url}}/poster"></video>
            <img src="file:///etc/passwd">
            <script>fetch("{{url}}/fetch"); new Image().src = "{{url}}/script";</script>
            </body></html>
            """;
        using var client = new HttpClient
        {
            BaseAddress = new Uri($"http://{render.Hostname}:{render.GetMappedPublicPort(3000)}/"),
            Timeout = TimeSpan.FromSeconds(60),
        };
        var pdf = await new GotenbergRenderer(client).RenderAsync(hostile, 10 * 1024 * 1024, Ct);

        pdf.ShouldNotBeNull();
        pdf.AsSpan().StartsWith("%PDF-"u8).ShouldBeTrue();
        // A meta refresh (the sanitizer removes <meta>, this tests the next layer)
        // navigates to a blocked page. Chromium may then fail to print, and penny-render
        // answers 4xx or 5xx, but it never connects.
        try
        {
            await new GotenbergRenderer(client).RenderAsync(
                $"<html><head><meta http-equiv=\"refresh\" content=\"0;url={url}/refresh\"></head><body><img src=\"{url}/after-refresh\"></body></html>",
                10 * 1024 * 1024,
                Ct
            );
        }
        catch (Penny.Backend.Application.Abstractions.InboundMail.MailRendererUnavailableException)
        {
            // A 5xx: the conversion failed inside penny-render.
        }
        await Task.Delay(TimeSpan.FromSeconds(2), Ct);
        requests.ShouldBe(["/control"]);
    }

    [Fact]
    public async Task whenOtherRoutesCalled_PennyRender_ShouldOnlyServeHtmlConversion()
    {
        using var client = new HttpClient
        {
            BaseAddress = new Uri($"http://{render.Hostname}:{render.GetMappedPublicPort(3000)}/"),
        };
        foreach (
            var route in new[]
            {
                "forms/libreoffice/convert",
                "forms/pdfengines/merge",
                "forms/chromium/convert/url",
            }
        )
        {
            using var form = new MultipartFormDataContent
            {
                { new StringContent($"{"http"}://{CanaryHost}:{CanaryPort}/url"), "url" },
            };
            using var response = await client.PostAsync(route, form, Ct);
            ((int)response.StatusCode).ShouldBeGreaterThanOrEqualTo(400, route);
        }
        requests.ShouldNotContain("/url");
    }

    // The penny-render service's image and command, read from deploy/compose.yaml.
    private static (string Image, List<string> Command) ComposeService()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (
            directory is not null
            && !File.Exists(Path.Combine(directory.FullName, "deploy", "compose.yaml"))
        )
            directory = directory.Parent;
        var lines = File.ReadAllLines(Path.Combine(directory!.FullName, "deploy", "compose.yaml"));
        var start = Array.FindIndex(lines, line => line == "  penny-render:");
        start.ShouldBeGreaterThan(0, "deploy/compose.yaml defines penny-render");
        string? image = null;
        var command = new List<string>();
        var inCommand = false;
        for (
            var index = start + 1;
            index < lines.Length
                && (
                    lines[index].Length == 0
                    || lines[index].StartsWith("    ", StringComparison.Ordinal)
                );
            index++
        )
        {
            var line = lines[index];
            if (line.StartsWith("    image: ", StringComparison.Ordinal))
                image = line["    image: ".Length..].Trim();
            else if (line == "    command:")
                inCommand = true;
            else if (inCommand && line.StartsWith("      - ", StringComparison.Ordinal))
                command.Add(line["      - ".Length..].Trim());
            else
                inCommand = false;
        }
        image.ShouldNotBeNull();
        command.ShouldContain("--chromium-disable-javascript");
        return (image!, command);
    }

    private async Task AcceptAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient connection;
            try
            {
                connection = await canary.AcceptTcpClientAsync(stop.Token);
            }
            catch (Exception) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            _ = Task.Run(async () =>
            {
                using (connection)
                {
                    var stream = connection.GetStream();
                    var buffer = new byte[4096];
                    var read = await stream.ReadAsync(buffer);
                    var line = Encoding.ASCII.GetString(buffer, 0, read).Split("\r\n")[0];
                    var parts = line.Split(' ');
                    requests.Enqueue(parts.Length > 1 ? parts[1] : line);
                    await stream.WriteAsync(
                        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"u8.ToArray()
                    );
                }
            });
        }
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 50 && !condition(); attempt++)
            await Task.Delay(100, Ct);
        condition().ShouldBeTrue();
    }
}
