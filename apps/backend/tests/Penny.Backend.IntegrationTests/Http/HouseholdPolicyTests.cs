using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Penny.Backend.Api.Households;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class HouseholdPolicyTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenJoinAttemptsExceedWindow_InviteRateLimit_ShouldReturnLegacyTooManyRequests()
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Auth:InviteRateLimitPermits"] = "3" }
        );
        factory.UseKestrel(0);
        using var client = CreateClient(factory);
        var token = await RegisterAsync("guesser@example.test", client);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var request = Authorized(HttpMethod.Post, "/api/households/join", bearer: token);
            request.Content = JsonContent.Create(new { code = "0000000000" });
            using var guess = await client.SendAsync(request, Ct);
            guess.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        using (var request = Authorized(HttpMethod.Post, "/api/households/join", bearer: token))
        {
            request.Content = JsonContent.Create(new { code = "0000000000" });
            using var limited = await client.SendAsync(request, Ct);
            await AuthTests.ShouldBeErrorAsync(
                limited,
                (HttpStatusCode)429,
                InviteRateLimit.Message
            );
            int.Parse(
                    limited.Headers.GetValues("Retry-After").Single(),
                    CultureInfo.InvariantCulture
                )
                .ShouldBeInRange(1, 600);
        }
        // Other household routes and sign-in keep their own budgets.
        using (
            var list = await client.SendAsync(
                Authorized(HttpMethod.Get, "/api/households", bearer: token),
                Ct
            )
        )
            list.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "guesser@example.test", password = TestPassword },
            Ct
        );
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
