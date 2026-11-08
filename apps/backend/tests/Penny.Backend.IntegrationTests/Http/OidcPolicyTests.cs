using System.Net;
using System.Net.Http.Json;
using Penny.Backend.Api.Middleware;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class OidcPolicyTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    private const string Limited = "Too many attempts. Please try again in 15 minutes.";

    [Fact]
    public async Task whenSignInAttemptsExceedWindow_RateLimit_ShouldShareBudgetWithPasswordSignIn()
    {
        var settings = FakeOidcProvider.Settings();
        settings["Auth:RateLimitPermits"] = "4";
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection, settings);
        using var client = CreateClient(api);
        using (var login = await client.PostAsJsonAsync("/api/auth/login", new { }, Ct))
            login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        // start + complete use two more permits, register the last one.
        using (var signedIn = await SignInAsync(client))
            signedIn.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (var register = await client.PostAsJsonAsync("/api/auth/register", new { }, Ct))
            register.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        foreach (
            var path in new[]
            {
                "/api/auth/oidc/start",
                "/api/auth/oidc/complete",
                "/api/auth/login",
            }
        )
        {
            using var limited = await client.PostAsJsonAsync(path, new { }, Ct);
            await AuthTests.ShouldBeErrorAsync(limited, (HttpStatusCode)429, Limited);
            limited.Headers.Contains("Retry-After").ShouldBeTrue();
        }
        // Availability is not a sign-in attempt.
        using var config = await client.GetAsync("/api/auth/oidc", Ct);
        config.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenOriginNotAllowed_OidcRoutes_ShouldRejectBrowserWrites()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var (transaction, callbackUrl) = await BeginAsync(client);
        foreach (
            var (path, body) in new (string, object)[]
            {
                ("/api/auth/oidc/start", new { redirectUri = FakeOidcProvider.WebRedirect }),
                ("/api/auth/oidc/complete", new { transaction, callbackUrl }),
            }
        )
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path)
            {
                Content = JsonContent.Create(body),
            };
            request.Headers.Add("Origin", "https://attacker.example.test");
            using var refused = await client.SendAsync(request, Ct);
            await AuthTests.ShouldBeErrorAsync(
                refused,
                HttpStatusCode.Forbidden,
                OriginPolicyMiddleware.Message
            );
        }
        // The refused completion did not consume the attempt.
        using var allowed = new HttpRequestMessage(HttpMethod.Post, "/api/auth/oidc/complete")
        {
            Content = JsonContent.Create(new { transaction, callbackUrl }),
        };
        allowed.Headers.Add("Origin", "http://localhost:8081");
        using var completed = await client.SendAsync(allowed, Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
        completed
            .Headers.GetValues("Access-Control-Allow-Origin")
            .Single()
            .ShouldBe("http://localhost:8081");
        Provider.TokenRequests.ShouldBe(1);
    }
}
