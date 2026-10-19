using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Penny.Backend.Api;
using Penny.Backend.Domain;
using Xunit;

namespace Penny.Backend.IntegrationTests;

public sealed class BackendHttpTests
{
    [Fact]
    public void InvalidConfigurationFailsDuringBoot()
    {
        Action invalidBodyLimit = () => BackendApp.Create(["--Backend:MaxRequestBodyBytes=0"]);
        Action invalidShutdown = () => BackendApp.Create(["--Backend:ShutdownTimeoutSeconds=301"]);

        invalidBodyLimit.Should().Throw<InvalidOperationException>();
        invalidShutdown.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public async Task HealthAndReadinessUseRealHttpAndReportStorageFailure()
    {
        await using var backend = await RunningBackend.StartAsync();

        using var health = await backend.Client.GetAsync(
            "/api/health",
            TestContext.Current.CancellationToken
        );
        health.StatusCode.Should().Be(HttpStatusCode.OK);
        (await health.Content.ReadFromJsonAsync<HealthBody>(TestContext.Current.CancellationToken))!
            .Ok.Should()
            .BeTrue();
        health.Headers.CacheControl!.ToString().Should().Be("no-store");
        health
            .Headers.GetValues("X-Content-Type-Options")
            .Should()
            .ContainSingle()
            .Which.Should()
            .Be("nosniff");

        using var ready = await backend.Client.GetAsync(
            "/api/ready",
            TestContext.Current.CancellationToken
        );
        ready.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ready.Content.ReadFromJsonAsync<HealthBody>(TestContext.Current.CancellationToken))!
            .Ok.Should()
            .BeTrue();

        Directory.Delete(backend.DataDirectory);
        using var unready = await backend.Client.GetAsync(
            "/api/ready",
            TestContext.Current.CancellationToken
        );
        unready.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (
            await unready.Content.ReadFromJsonAsync<HealthBody>(
                TestContext.Current.CancellationToken
            )
        )!
            .Ok.Should()
            .BeFalse();
    }

    [Theory]
    [InlineData(FailureKind.Invalid, HttpStatusCode.BadRequest)]
    [InlineData(FailureKind.Unauthorized, HttpStatusCode.Unauthorized)]
    [InlineData(FailureKind.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(FailureKind.NotFound, HttpStatusCode.NotFound)]
    [InlineData(FailureKind.Conflict, HttpStatusCode.Conflict)]
    public async Task ApplicationFailuresKeepTheLegacyErrorEnvelope(
        FailureKind kind,
        HttpStatusCode status
    )
    {
        await using var backend = await RunningBackend.StartAsync();

        await AssertError(backend.Client, $"/api/test/failure/{kind}", status, "Expected failure.");
    }

    [Fact]
    public async Task UnexpectedAndMalformedFailuresDoNotLeakDetails()
    {
        await using var backend = await RunningBackend.StartAsync();

        await AssertError(
            backend.Client,
            "/api/test/unexpected",
            HttpStatusCode.InternalServerError,
            "The server could not complete this request."
        );
        await AssertError(
            backend.Client,
            "/api/test/json",
            HttpStatusCode.BadRequest,
            "Invalid JSON."
        );
        await AssertError(
            backend.Client,
            "/api/missing",
            HttpStatusCode.NotFound,
            "API route not found."
        );
    }

    [Fact]
    public async Task InvalidControllerBodyUsesTheLegacyErrorEnvelope()
    {
        await using var backend = await RunningBackend.StartAsync();
        using var response = await backend.Client.PostAsync(
            "/api/test/payload",
            new StringContent("{invalid", System.Text.Encoding.UTF8, "application/json"),
            TestContext.Current.CancellationToken
        );
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (
            await response.Content.ReadFromJsonAsync<ErrorBody>(
                TestContext.Current.CancellationToken
            )
        )!
            .Error.Should()
            .Be("Invalid request.");
    }

    [Fact]
    public async Task OversizedRequestReturnsJsonError()
    {
        await using var backend = await RunningBackend.StartAsync();

        using var response = await backend.Client.PostAsync(
            "/api/missing",
            new StringContent(new string('x', 65)),
            TestContext.Current.CancellationToken
        );
        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (
            await response.Content.ReadFromJsonAsync<ErrorBody>(
                TestContext.Current.CancellationToken
            )
        )!
            .Error.Should()
            .Be("The upload is too large.");
    }

    [Fact]
    public async Task RequestCancellationReachesEndpoint()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var canceled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var backend = await RunningBackend.StartAsync(app =>
            app.MapGet(
                "/api/test/wait",
                async (CancellationToken cancellationToken) =>
                {
                    started.SetResult();
                    try
                    {
                        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                    }
                    catch (OperationCanceledException)
                        when (cancellationToken.IsCancellationRequested)
                    {
                        canceled.SetResult();
                    }
                    return Results.Ok();
                }
            )
        );

        using var source = new CancellationTokenSource();
        var request = backend.Client.GetAsync("/api/test/wait", source.Token);
        await started.Task.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken
        );
        source.Cancel();
        await canceled.Task.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken
        );
        Func<Task> act = async () => await request;
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task ShutdownDrainsAnInFlightRequest()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var backend = await RunningBackend.StartAsync(app =>
            app.MapGet(
                "/api/test/slow",
                async (CancellationToken cancellationToken) =>
                {
                    started.SetResult();
                    await release.Task.WaitAsync(cancellationToken);
                    return Results.Ok();
                }
            )
        );

        var configuredTimeout = backend
            .App.Services.GetRequiredService<IOptions<HostOptions>>()
            .Value.ShutdownTimeout;
        configuredTimeout.Should().Be(TimeSpan.FromSeconds(2));
        var request = backend.Client.GetAsync(
            "/api/test/slow",
            TestContext.Current.CancellationToken
        );
        await started.Task.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken
        );
        var stopping = backend.App.StopAsync(TestContext.Current.CancellationToken);
        await Task.Delay(100, TestContext.Current.CancellationToken);
        stopping.IsCompleted.Should().BeFalse();
        release.SetResult();
        using var response = await request.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken
        );
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await stopping.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
    }

    private static async Task AssertError(
        HttpClient client,
        string path,
        HttpStatusCode status,
        string message
    )
    {
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        response.StatusCode.Should().Be(status);
        (
            await response.Content.ReadFromJsonAsync<ErrorBody>(
                TestContext.Current.CancellationToken
            )
        )!
            .Error.Should()
            .Be(message);
    }

    private sealed record HealthBody(bool Ok);

    private sealed record ErrorBody(string Error);

    private sealed class RunningBackend(WebApplication app, HttpClient client, string dataDirectory)
        : IAsyncDisposable
    {
        public WebApplication App { get; } = app;
        public HttpClient Client { get; } = client;
        public string DataDirectory { get; } = dataDirectory;

        public static async Task<RunningBackend> StartAsync(
            Action<WebApplication>? configure = null
        )
        {
            var dataDirectory = Path.Combine(
                Path.GetTempPath(),
                $"penny-backend-test-{Guid.NewGuid():N}"
            );
            var app = BackendApp.Create(
                [
                    $"--Backend:DataDirectory={dataDirectory}",
                    "--Backend:MaxRequestBodyBytes=64",
                    "--Backend:ShutdownTimeoutSeconds=2",
                    "--Logging:LogLevel:Default=Warning",
                ],
                mvc => mvc.AddApplicationPart(typeof(TestFailureController).Assembly)
            );
            configure?.Invoke(app);
            app.Urls.Add("http://127.0.0.1:0");
            await app.StartAsync(TestContext.Current.CancellationToken);
            var address = app
                .Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            return new RunningBackend(
                app,
                new HttpClient { BaseAddress = new Uri(address) },
                dataDirectory
            );
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await App.StopAsync(TestContext.Current.CancellationToken);
            await App.DisposeAsync();
            if (Directory.Exists(DataDirectory))
                Directory.Delete(DataDirectory, recursive: true);
        }
    }
}

[ApiController]
[Route("api/test")]
public sealed class TestFailureController : ControllerBase
{
    [HttpGet("failure/{kind}")]
    public IActionResult Failure(FailureKind kind) =>
        throw new BackendFailure(kind, "Expected failure.");

    [HttpGet("unexpected")]
    public IActionResult Unexpected() => throw new Exception("private diagnostic");

    [HttpGet("json")]
    public IActionResult Json() => throw new JsonException("private diagnostic");

    [HttpPost("payload")]
    public IActionResult Payload([FromBody] TestPayload payload) => Ok(payload);
}

public sealed record TestPayload(string Value);
