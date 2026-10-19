using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Penny.Backend.Api;
using Penny.Backend.Application;
using Penny.Backend.Domain;

var tests = new (string Name, Func<Task> Run)[]
{
    ("configuration validates limits", TestConfiguration),
    ("application failures map to legacy statuses", TestErrorMapping),
    ("readiness forwards cancellation", TestCancellation),
    ("service boots and maps errors", TestHttp)
};

var failures = 0;
foreach (var (name, run) in tests)
{
    try
    {
        await run();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception error)
    {
        failures++;
        Console.Error.WriteLine($"FAIL {name}: {error}");
    }
}

return failures == 0 ? 0 : 1;

static Task TestConfiguration()
{
    Check.Throws<InvalidOperationException>(() => BackendOptions.Create(".", "0", null));
    Check.Throws<InvalidOperationException>(() => BackendOptions.Create(".", null, "301"));
    var options = BackendOptions.Create(".", null, null);
    Check.Equal(BackendOptions.DefaultMaxRequestBodyBytes, options.MaxRequestBodyBytes);
    return Task.CompletedTask;
}

static async Task TestCancellation()
{
    using var source = new CancellationTokenSource();
    var probe = new CapturingProbe();
    var readiness = new ReadinessService(probe);
    Check.True(await readiness.IsReadyAsync(source.Token));
    Check.Equal(source.Token, probe.Token);
}

static Task TestErrorMapping()
{
    var cases = new[]
    {
        (FailureKind.Invalid, 400),
        (FailureKind.Unauthorized, 401),
        (FailureKind.Forbidden, 403),
        (FailureKind.NotFound, 404),
        (FailureKind.Conflict, 409)
    };
    foreach (var (kind, status) in cases)
    {
        var mapped = ApiErrors.Map(new BackendFailure(kind, "expected"));
        Check.Equal(status, mapped.Status);
        Check.Equal("expected", mapped.Message);
    }
    Check.Equal(413, ApiErrors.Map(new BadHttpRequestException("too large", 413)).Status);
    Check.Equal((400, "Invalid JSON."), ApiErrors.Map(new JsonException("private diagnostic")));
    Check.Equal("The server could not complete this request.",
        ApiErrors.Map(new Exception("private diagnostic")).Message);
    return Task.CompletedTask;
}

static async Task TestHttp()
{
    var dataDirectory = Path.Combine(Path.GetTempPath(), $"penny-backend-test-{Guid.NewGuid():N}");
    var app = BackendApp.Create([
        $"--Backend:DataDirectory={dataDirectory}",
        "--Backend:MaxRequestBodyBytes=64",
        "--Backend:ShutdownTimeoutSeconds=2"
    ]);
    app.MapGet("/api/test/conflict", (Func<IResult>)(() => throw new BackendFailure(FailureKind.Conflict, "Revision changed.")));
    app.MapGet("/api/test/failure", (Func<IResult>)(() => throw new Exception("private diagnostic")));
    var slowStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var releaseSlow = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    app.MapGet("/api/test/slow", async (CancellationToken cancellationToken) =>
    {
        slowStarted.SetResult();
        await releaseSlow.Task.WaitAsync(cancellationToken);
        return Results.Ok();
    });
    app.Urls.Add("http://127.0.0.1:0");

    try
    {
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        var shutdown = app.Services.GetRequiredService<IOptions<HostOptions>>().Value;
        Check.Equal(TimeSpan.FromSeconds(2), shutdown.ShutdownTimeout);

        using var health = await client.GetAsync("/api/health");
        Check.Equal(HttpStatusCode.OK, health.StatusCode);
        Check.True((await health.Content.ReadFromJsonAsync<HealthBody>())!.Ok);
        Check.Equal("no-store", health.Headers.CacheControl!.ToString());

        using var ready = await client.GetAsync("/api/ready");
        Check.Equal(HttpStatusCode.OK, ready.StatusCode);
        Directory.Delete(dataDirectory);
        using var unready = await client.GetAsync("/api/ready");
        Check.Equal(HttpStatusCode.ServiceUnavailable, unready.StatusCode);
        Check.True(!(await unready.Content.ReadFromJsonAsync<HealthBody>())!.Ok);

        await Check.Error(client, "/api/test/conflict", HttpStatusCode.Conflict, "Revision changed.");
        await Check.Error(client, "/api/test/failure", HttpStatusCode.InternalServerError,
            "The server could not complete this request.");
        await Check.Error(client, "/api/missing", HttpStatusCode.NotFound, "API route not found.");

        using var oversized = await client.PostAsync("/api/missing", new StringContent(new string('x', 65)));
        Check.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);
        Check.Equal("The upload is too large.",
            (await oversized.Content.ReadFromJsonAsync<ErrorBody>())!.Error);

        var slowRequest = client.GetAsync("/api/test/slow");
        await slowStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var stopping = app.StopAsync();
        await Task.Delay(100);
        Check.True(!stopping.IsCompleted);
        releaseSlow.SetResult();
        using var slowResponse = await slowRequest.WaitAsync(TimeSpan.FromSeconds(5));
        Check.Equal(HttpStatusCode.OK, slowResponse.StatusCode);
        await stopping.WaitAsync(TimeSpan.FromSeconds(5));
    }
    finally
    {
        await app.StopAsync();
        await app.DisposeAsync();
        if (Directory.Exists(dataDirectory)) Directory.Delete(dataDirectory, recursive: true);
    }
}

sealed record HealthBody(bool Ok);
sealed record ErrorBody(string Error);

sealed class CapturingProbe : IStorageReadiness
{
    public CancellationToken Token { get; private set; }

    public Task<bool> IsReadyAsync(CancellationToken cancellationToken)
    {
        Token = cancellationToken;
        return Task.FromResult(true);
    }
}

static class Check
{
    public static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new Exception($"Expected {expected}, got {actual}.");
    }

    public static void True(bool value)
    {
        if (!value) throw new Exception("Expected true.");
    }

    public static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new Exception($"Expected {typeof(T).Name}.");
    }

    public static async Task Error(HttpClient client, string path, HttpStatusCode status, string message)
    {
        using var response = await client.GetAsync(path);
        Equal(status, response.StatusCode);
        Equal(message, (await response.Content.ReadFromJsonAsync<ErrorBody>())!.Error);
    }
}
