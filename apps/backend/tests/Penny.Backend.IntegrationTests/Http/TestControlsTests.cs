using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Api.Testing;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Testing;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-62 test controls on a real host and database: absent unless enabled, refused in
// Production, token-guarded, and their clock, faults and reset reach the product API.
public sealed class TestControlsTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private static readonly string Token = Convert.ToHexStringLower(
        System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)
    );

    private TestApiFactory ControlledHost(Dictionary<string, string>? extra = null)
    {
        var settings = new Dictionary<string, string>
        {
            ["TestControls:Enabled"] = "true",
            ["TestControls:Token"] = Token,
        };
        foreach (var (key, value) in extra ?? [])
            settings[key] = value;
        // The product services use the controllable clock, not the shared TestClock.
        var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            settings,
            services =>
                services.AddSingleton<TimeProvider>(provider =>
                    provider.GetRequiredService<ControllableClock>()
                )
        );
        factory.UseKestrel(0);
        return factory;
    }

    private static HttpRequestMessage Control(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, "/api/test/" + path);
        request.Headers.Add(TestControlsController.TokenHeader, Token);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        return request;
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpRequestMessage request)
    {
        using (request)
        using (var response = await client.SendAsync(request, Ct))
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
            response.IsSuccessStatusCode.ShouldBeTrue(body.ToString());
            return body;
        }
    }

    [Fact]
    public async Task whenControlsDisabled_TestRoutes_ShouldNotBeMapped()
    {
        using (var anonymous = await Client.SendAsync(Control(HttpMethod.Get, "state"), Ct))
            anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var session = await RegisterAsync("disabled@example.test");
        foreach (var path in new[] { "state", "reset", "users", "clock", "faults" })
        {
            using var request = Authorized(HttpMethod.Post, "/api/test/" + path, bearer: session);
            request.Headers.Add(TestControlsController.TokenHeader, Token);
            using var response = await Client.SendAsync(request, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound, path);
        }
        Fixture.Factory.Services.GetService<FaultRegistry>().ShouldBeNull();
        Fixture.Factory.Services.GetService<TestDataReset>().ShouldBeNull();
    }

    [Fact]
    public async Task whenEnabledInProduction_Startup_ShouldRefuseTestControls()
    {
        await using var factory = ControlledHost(new() { ["environment"] = "Production" });
        var failure = Should.Throw<Exception>(() => factory.StartServer());
        (failure.ToString()).ShouldContain("Production");
    }

    [Fact]
    public async Task whenTokenMissingOrWrong_Controls_ShouldForbid()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        using (var missing = await client.GetAsync("/api/test/state", Ct))
            missing.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        using var wrong = new HttpRequestMessage(HttpMethod.Post, "/api/test/reset");
        // Always differs from Token: a random token can itself end in "0".
        wrong.Headers.Add(
            TestControlsController.TokenHeader,
            Token[..^1] + (Token[^1] == '0' ? "1" : "0")
        );
        using (var response = await client.SendAsync(wrong, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await SendAsync(client, Control(HttpMethod.Get, "state")))
            .GetProperty("environment")
            .GetString()
            .ShouldBe("Development");
    }

    [Fact]
    public async Task whenClockPinned_ProductApi_ShouldUsePinnedTime()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        await SendAsync(
            client,
            Control(HttpMethod.Put, "clock", new { now = "2026-01-01T12:00:00Z" })
        );
        var user = await SendAsync(
            client,
            Control(HttpMethod.Post, "users", new { label = "clock" })
        );
        var token = user.GetProperty("token").GetString()!;
        using (
            var me = await client.SendAsync(
                Authorized(HttpMethod.Get, "/api/auth/me", bearer: token),
                Ct
            )
        )
            me.StatusCode.ShouldBe(HttpStatusCode.OK);
        // Sessions last 30 days of server time.
        await SendAsync(
            client,
            Control(HttpMethod.Put, "clock", new { now = "2026-02-15T12:00:00Z" })
        );
        using (
            var expired = await client.SendAsync(
                Authorized(HttpMethod.Get, "/api/auth/me", bearer: token),
                Ct
            )
        )
            expired.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var state = await SendAsync(client, Control(HttpMethod.Delete, "clock"));
        state.GetProperty("clockPinned").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task whenUsersCreated_Controls_ShouldIssueDistinctSyntheticAccounts()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        var users = await Task.WhenAll(
            Enumerable
                .Range(0, 5)
                .Select(_ =>
                    SendAsync(client, Control(HttpMethod.Post, "users", new { label = "web" }))
                )
        );
        users.Select(user => user.GetProperty("email").GetString()).Distinct().Count().ShouldBe(5);
        users.ShouldAllBe(user => user.GetProperty("email").GetString()!.EndsWith("@penny.test"));
        foreach (var user in users)
        {
            using var login = await client.PostAsJsonAsync(
                "/api/auth/login",
                new
                {
                    email = user.GetProperty("email").GetString(),
                    password = user.GetProperty("password").GetString(),
                },
                Ct
            );
            login.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        using var invalid = Control(HttpMethod.Post, "users", new { label = "Not Valid!" });
        using (var rejected = await client.SendAsync(invalid, Ct))
            rejected.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task whenFaultsInjected_Requests_ShouldFailExactlyThatOftenThenRecover()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        var token = (await SendAsync(client, Control(HttpMethod.Post, "users")))
            .GetProperty("token")
            .GetString()!;
        await SendAsync(
            client,
            Control(
                HttpMethod.Put,
                "faults",
                new
                {
                    rules = new[]
                    {
                        new
                        {
                            method = "GET",
                            pathPrefix = "/api/auth/me",
                            status = 503,
                            times = 3,
                        },
                    },
                }
            )
        );
        var statuses = await Task.WhenAll(
            Enumerable
                .Range(0, 10)
                .Select(async _ =>
                {
                    using var response = await client.SendAsync(
                        Authorized(HttpMethod.Get, "/api/auth/me", bearer: token),
                        Ct
                    );
                    return response.StatusCode;
                })
        );
        statuses.Count(status => status == HttpStatusCode.ServiceUnavailable).ShouldBe(3);
        statuses.Count(status => status == HttpStatusCode.OK).ShouldBe(7);

        // An unconditional fault never blocks the controls that clear it.
        await SendAsync(
            client,
            Control(HttpMethod.Put, "faults", new { rules = new[] { new { status = 500 } } })
        );
        using (var failing = await client.GetAsync("/api/health", Ct))
        {
            failing.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            (await failing.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("error")
                .GetString()
                .ShouldBe(FaultInjectionMiddleware.Message);
        }
        await SendAsync(client, Control(HttpMethod.Delete, "faults"));
        using (var healthy = await client.GetAsync("/api/health", Ct))
            healthy.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenAbortOrInvalidFaultRequested_Faults_ShouldDropConnectionOrRejectRule()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        await SendAsync(
            client,
            Control(
                HttpMethod.Put,
                "faults",
                new
                {
                    rules = new[]
                    {
                        new
                        {
                            pathPrefix = "/api/health",
                            abort = true,
                            times = 1,
                        },
                    },
                }
            )
        );
        await Should.ThrowAsync<HttpRequestException>(() => client.GetAsync("/api/health", Ct));
        using (var recovered = await client.GetAsync("/api/health", Ct))
            recovered.StatusCode.ShouldBe(HttpStatusCode.OK);
        foreach (
            var rule in new object[]
            {
                new { target = "email", status = 500 },
                new { status = 200 },
                new { pathPrefix = "api", status = 500 },
                new { delayMs = 60_000 },
                new { times = 0, status = 500 },
                new { method = "GET" },
            }
        )
        {
            using var request = Control(HttpMethod.Put, "faults", new { rules = new[] { rule } });
            using var response = await client.SendAsync(request, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, rule.ToString());
        }
    }

    [Fact]
    public async Task whenReset_Controls_ShouldDeleteDataAndKeepSchema()
    {
        await using var factory = ControlledHost();
        using var client = CreateClient(factory);
        var user = await SendAsync(client, Control(HttpMethod.Post, "users"));
        await SendAsync(
            client,
            Control(HttpMethod.Put, "clock", new { now = "2026-10-15T12:00:00Z" })
        );
        await SendAsync(
            client,
            Control(
                HttpMethod.Put,
                "faults",
                new { rules = new[] { new { pathPrefix = "/api/households", status = 503 } } }
            )
        );
        var reset = await SendAsync(client, Control(HttpMethod.Post, "reset"));
        reset.GetProperty("tables").GetInt32().ShouldBeGreaterThan(20);
        using (
            var login = await client.PostAsJsonAsync(
                "/api/auth/login",
                new
                {
                    email = user.GetProperty("email").GetString(),
                    password = user.GetProperty("password").GetString(),
                },
                Ct
            )
        )
            login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var state = await SendAsync(client, Control(HttpMethod.Get, "state"));
        state.GetProperty("clockPinned").GetBoolean().ShouldBeFalse();
        state.GetProperty("faults").GetArrayLength().ShouldBe(0);
        using (var ready = await client.GetAsync("/api/ready", Ct))
            ready.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenDatabaseOutsideTestPrefix_Reset_ShouldRefuseAndKeepData()
    {
        await RegisterAsync("kept@example.test");
        var reset = new TestDataReset(Fixture.Admin);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            reset.ResetAsync("penny_test_other", Ct)
        );
        await Should.ThrowAsync<InvalidOperationException>(() => reset.ResetAsync("", Ct));
        using var login = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "kept@example.test", password = TestPassword },
            Ct
        );
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
