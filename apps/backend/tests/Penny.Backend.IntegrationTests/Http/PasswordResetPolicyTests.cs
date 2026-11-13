using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Middleware;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class PasswordResetPolicyTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Email = "person@example.test";
    private const string NewPassword = "a brand new password";

    [Fact]
    public async Task whenAttemptsExceedWindow_PasswordReset_ShouldShareRateLimitWithSignIn()
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Auth:RateLimitPermits"] = "3" }
        );
        using var client = CreateClient(factory);
        using (var login = await client.PostAsJsonAsync("/api/auth/login", new { }, Ct))
            login.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        using (var reset = await ResetPasswordAsync(new { }, client))
            reset.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using (var register = await client.PostAsJsonAsync("/api/auth/register", new { }, Ct))
            register.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        foreach (var path in new[] { "/api/auth/password-reset", "/api/auth/login" })
        {
            using var limited = await client.PostAsJsonAsync(path, new { }, Ct);
            await AuthTests.ShouldBeErrorAsync(limited, (HttpStatusCode)429, AuthRateLimit.Message);
            limited.Headers.Contains("Retry-After").ShouldBeTrue();
        }
    }

    [Fact]
    public async Task whenOriginNotAllowed_PasswordReset_ShouldRejectWithoutConsumingCode()
    {
        await RegisterAsync(Email);
        var reset = await IssueResetAsync(Email);
        using var refused = new HttpRequestMessage(HttpMethod.Post, "/api/auth/password-reset")
        {
            Content = JsonContent.Create(new { token = reset.Token, password = NewPassword }),
        };
        refused.Headers.Add("Origin", "https://attacker.example.test");
        using (var response = await Client.SendAsync(refused, Ct))
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.Forbidden,
                OriginPolicyMiddleware.Message
            );

        using var allowed = new HttpRequestMessage(HttpMethod.Post, "/api/auth/password-reset")
        {
            Content = JsonContent.Create(new { token = reset.Token, password = NewPassword }),
        };
        allowed.Headers.Add("Origin", "http://localhost:4173");
        using var completed = await Client.SendAsync(allowed, Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
        completed
            .Headers.GetValues("Access-Control-Allow-Origin")
            .Single()
            .ShouldBe("http://localhost:4173");
    }

    [Fact]
    public async Task whenResetAttempted_PasswordReset_ShouldKeepCodesAndPasswordsOutOfLogs()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Logging:LogLevel:Default"] = "Trace",
                ["Logging:LogLevel:Microsoft.AspNetCore"] = "Trace",
            },
            services =>
            {
                // Capture only; keep trace output off the test console.
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(logs);
            }
        );
        using var client = CreateClient(factory);
        await RegisterAsync(Email, client);
        var reset = await IssueResetAsync(Email, factory);
        var unknown = SessionTokens.Create();
        using (
            var rejected = await ResetPasswordAsync(
                new { token = unknown, password = NewPassword },
                client
            )
        )
            rejected.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using (
            var completed = await ResetPasswordAsync(
                new { token = reset.Token, password = NewPassword },
                client
            )
        )
            completed.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Trace logging is on (every request is logged), yet no message contains a
        // code, its hash or a password.
        logs.Messages.ShouldContain(message => message.Contains("/api/auth/password-reset"));
        foreach (
            var secret in new[]
            {
                reset.Token,
                SessionTokens.Hash(reset.Token),
                unknown,
                SessionTokens.Hash(unknown),
                NewPassword,
                TestPassword,
            }
        )
            logs.Messages.ShouldNotContain(message => message.Contains(secret));
    }
}
