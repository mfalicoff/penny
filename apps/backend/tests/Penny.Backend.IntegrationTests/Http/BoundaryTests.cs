using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Domain.Errors;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.IntegrationTests.Infrastructure.Probes;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class BoundaryTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Theory]
    [InlineData(FailureKind.Invalid, HttpStatusCode.BadRequest)]
    [InlineData(FailureKind.Unauthorized, HttpStatusCode.Unauthorized)]
    [InlineData(FailureKind.Forbidden, HttpStatusCode.Forbidden)]
    [InlineData(FailureKind.NotFound, HttpStatusCode.NotFound)]
    [InlineData(FailureKind.Conflict, HttpStatusCode.Conflict)]
    public async Task whenDomainFailureThrown_ApiBoundary_ShouldReturnLegacyErrorEnvelope(
        FailureKind kind,
        HttpStatusCode expected
    )
    {
        using var response = await Client.GetAsync($"/api/test/failure/{kind}", Ct);
        response.StatusCode.ShouldBe(expected);
        var body = await response.Content.ReadFromJsonAsync<ApiError>(Ct);
        body!.Error.ShouldBe("Synthetic domain failure.");
    }

    [Fact]
    public async Task whenUnexpectedFailureOrUnknownRoute_ApiBoundary_ShouldReturnJsonWithoutPrivateDetails()
    {
        using var unexpected = await Client.GetAsync("/api/test/unexpected", Ct);
        unexpected.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        var body = await unexpected.Content.ReadAsStringAsync(Ct);
        body.ShouldContain("error");
        body.ShouldNotContain("synthetic-secret");
        body.ShouldNotContain("stack");
        using var missing = await Client.GetAsync("/api/missing", Ct);
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await missing.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldNotBeNullOrEmpty();
    }

    [Theory]
    [InlineData("{invalid")]
    [InlineData("{\"value\":\"\"}")]
    public async Task whenBodyMalformedOrInvalid_ControllerValidation_ShouldReturnJsonBadRequest(
        string json
    )
    {
        using var response = await Client.PostAsync(
            "/api/test/body",
            new StringContent(json, Encoding.UTF8, "application/json"),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenBodyExceedsLimit_RequestBodyFlow_ShouldReturnPayloadTooLarge()
    {
        using var known = await Client.PostAsync(
            "/api/test/body",
            new StringContent(new string('x', 257)),
            Ct
        );
        known.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        using var chunked = new HttpRequestMessage(HttpMethod.Post, "/api/test/body");
        chunked.Headers.TransferEncodingChunked = true;
        chunked.Content = new StreamContent(
            new MemoryStream(Encoding.UTF8.GetBytes("{\"value\":\"" + new string('x', 300) + "\"}"))
        );
        chunked.Content.Headers.ContentType = new("application/json");
        using var response = await Client.SendAsync(chunked, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenClientAborts_RequestFlow_ShouldCancelEndpointWork()
    {
        var signals = Fixture.Factory.Services.GetRequiredService<ProbeSignals>();
        using var abort = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        var request = Client.GetAsync("/api/test/wait", abort.Token);
        await signals.Started.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        await abort.CancelAsync();
        await Should.ThrowAsync<OperationCanceledException>(() => request);
        await signals.Canceled.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
    }

    [Fact]
    public async Task whenDeadlineExpires_RequestTimeoutFlow_ShouldCancelWorkAndReturnRetryableJson()
    {
        using var response = await Client.GetAsync("/api/test/wait", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        response.Headers.RetryAfter!.Delta.ShouldBe(TimeSpan.FromSeconds(5));
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        response.Headers.GetValues("X-Content-Type-Options").Single().ShouldBe("nosniff");
        (await response.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldContain("timed out");
        Fixture
            .Factory.Services.GetRequiredService<ProbeSignals>()
            .Canceled.Task.IsCompleted.ShouldBeTrue();
    }

    [Fact]
    public async Task whenShutdownRequested_HostLifetimeFlow_ShouldDrainInFlightRequests()
    {
        // Stopping the host requires a dedicated lifetime; it shares the suite's real database.
        await using var factory = new TestApiFactory(Fixture.RuntimeConnection);
        factory.UseKestrel(0);
        using var client = factory.CreateClient();
        var signals = factory.Services.GetRequiredService<ProbeSignals>();
        var lifetime = factory.Services.GetRequiredService<IHostApplicationLifetime>();
        var stoppingSignal = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        using var registration = lifetime.ApplicationStopping.Register(() =>
            stoppingSignal.TrySetResult()
        );
        var request = client.GetAsync("/api/test/drain", Ct);
        await signals.Started.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        var stop = factory.Services.GetRequiredService<IHost>().StopAsync(Ct);
        await stoppingSignal.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        stop.IsCompleted.ShouldBeFalse();
        signals.Release.TrySetResult();
        using var response = await request.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        await stop.WaitAsync(TimeSpan.FromSeconds(5), Ct);
    }
}
