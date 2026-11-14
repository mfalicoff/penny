using System.Net;
using System.Net.Http.Json;
using Npgsql;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class SecurityPolicyTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Allowed = "http://localhost:4173";
    private const string Rejected = "https://attacker.example.test";
    private const string Limited = "Too many attempts. Please try again in 15 minutes.";

    [Fact]
    public async Task whenOriginNotAllowed_OriginPolicy_ShouldRejectWritesButAllowReadsAndListedPreflight()
    {
        var token = await RegisterAsync("person@example.test");
        foreach (
            var method in new[]
            {
                HttpMethod.Post,
                HttpMethod.Put,
                HttpMethod.Delete,
                HttpMethod.Head,
            }
        )
        {
            using var write = Authorized(method, "/api/auth/logout", bearer: token);
            write.Headers.Add("Origin", Rejected);
            using var response = await Client.SendAsync(write, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            if (method != HttpMethod.Head)
                await AuthTests.ShouldBeErrorAsync(
                    response,
                    HttpStatusCode.Forbidden,
                    "This origin is not allowed."
                );
        }

        // A refused logout did not revoke the session; reads are not origin-checked.
        using var read = Authorized(HttpMethod.Get, "/api/auth/me", bearer: token);
        read.Headers.Add("Origin", Rejected);
        using var readResponse = await Client.SendAsync(read, Ct);
        readResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        readResponse.Headers.Contains("Access-Control-Allow-Origin").ShouldBeFalse();

        using var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/ledger");
        preflight.Headers.Add("Origin", Allowed);
        preflight.Headers.Add("Access-Control-Request-Method", "PUT");
        preflight.Headers.Add("Access-Control-Request-Headers", "content-type,authorization");
        using var allowed = await Client.SendAsync(preflight, Ct);
        allowed.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        allowed.Headers.GetValues("Access-Control-Allow-Origin").Single().ShouldBe(Allowed);
        allowed.Headers.GetValues("Access-Control-Allow-Credentials").Single().ShouldBe("true");

        using var foreign = new HttpRequestMessage(HttpMethod.Options, "/api/ledger");
        foreign.Headers.Add("Origin", Rejected);
        foreign.Headers.Add("Access-Control-Request-Method", "PUT");
        using var refused = await Client.SendAsync(foreign, Ct);
        refused.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        refused.Headers.Contains("Access-Control-Allow-Origin").ShouldBeFalse();

        using var listed = Authorized(HttpMethod.Post, "/api/auth/logout", bearer: token);
        listed.Headers.Add("Origin", Allowed);
        using var loggedOut = await Client.SendAsync(listed, Ct);
        loggedOut.StatusCode.ShouldBe(HttpStatusCode.OK);
        loggedOut.Headers.GetValues("Access-Control-Allow-Origin").Single().ShouldBe(Allowed);
        loggedOut.Headers.GetValues("Access-Control-Allow-Credentials").Single().ShouldBe("true");
    }

    [Fact]
    public async Task whenSignInAttemptsExceedWindow_RateLimit_ShouldReturnTooManyRequestsPerHost()
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Auth:RateLimitPermits"] = "40" }
        );
        factory.UseKestrel(0);
        using var client = CreateClient(factory);
        using (var register = await client.PostAsJsonAsync("/api/auth/register", new { }, Ct))
            register.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        for (var attempt = 0; attempt < 39; attempt++)
        {
            using var login = await client.PostAsJsonAsync("/api/auth/login", new { }, Ct);
            login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        }
        foreach (var path in new[] { "/api/auth/login", "/api/auth/register" })
        {
            using var limited = await client.PostAsJsonAsync(path, new { }, Ct);
            await AuthTests.ShouldBeErrorAsync(limited, (HttpStatusCode)429, Limited);
            int.Parse(
                    limited.Headers.GetValues("Retry-After").Single(),
                    System.Globalization.CultureInfo.InvariantCulture
                )
                .ShouldBeInRange(1, 900);
        }
        // Other routes and other hosts keep working.
        using (var health = await client.GetAsync("/api/health", Ct))
            health.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var other = await Client.PostAsJsonAsync("/api/auth/login", new { }, Ct);
        other.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("127.0.0.1", true)]
    public async Task whenForwardedForSent_RateLimit_ShouldOnlyTrustConfiguredProxies(
        string trustedProxies,
        bool separateClients
    )
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Auth:RateLimitPermits"] = "1",
                ["Auth:TrustedProxies"] = trustedProxies,
            }
        );
        factory.UseKestrel(0);
        using var client = CreateClient(factory);
        (await AttemptAsync(client, "198.51.100.1")).ShouldBe(HttpStatusCode.Unauthorized);
        (await AttemptAsync(client, "198.51.100.1")).ShouldBe((HttpStatusCode)429);
        (await AttemptAsync(client, "198.51.100.2")).ShouldBe(
            separateClients ? HttpStatusCode.Unauthorized : (HttpStatusCode)429
        );
    }

    [Fact]
    public async Task whenDatabaseUnavailable_PublicRoutes_ShouldNotReadPresentedSessions()
    {
        // Port 1 is deliberately closed on loopback, not an external service.
        await using var factory = new TestApiFactory(
            new NpgsqlConnectionStringBuilder
            {
                Host = "127.0.0.1",
                Port = 1,
                Database = "synthetic",
                Username = "synthetic",
                Password = Guid.NewGuid().ToString("N"),
            }.ConnectionString
        );
        using var client = CreateClient(factory);
        var token = new string('a', 64);
        using var health = Authorized(
            HttpMethod.Get,
            "/api/health",
            bearer: token,
            cookie: $"penny_session={token}"
        );
        using var healthy = await client.SendAsync(health, Ct);
        healthy.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var me = Authorized(HttpMethod.Get, "/api/auth/me", bearer: token);
        using var failed = await client.SendAsync(me, Ct);
        await AuthTests.ShouldBeErrorAsync(
            failed,
            HttpStatusCode.InternalServerError,
            "The server could not complete this request."
        );
    }

    private static async Task<HttpStatusCode> AttemptAsync(HttpClient client, string forwardedFor)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new { }),
        };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        using var response = await client.SendAsync(request, Ct);
        return response.StatusCode;
    }
}
