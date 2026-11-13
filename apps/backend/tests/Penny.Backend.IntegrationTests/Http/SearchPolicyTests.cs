using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Penny.Backend.Api.Search;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// Session, origin, size, rate and time limits of search, the background embedding
// worker and log hygiene. Hosts with non-default settings share the test database.
public sealed class SearchPolicyTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private static HttpRequestMessage Search(string? token, object body)
    {
        var request = Authorized(HttpMethod.Post, SearchPath, bearer: token);
        request.Content = JsonContent.Create(body);
        return request;
    }

    [Fact]
    public async Task whenSessionOrOriginMissing_Search_ShouldRejectBeforeSearching()
    {
        using (var anonymous = await Client.SendAsync(Search(null, new { query = "coffee" }), Ct))
            await AuthTests.ShouldBeErrorAsync(
                anonymous,
                HttpStatusCode.Unauthorized,
                Penny.Backend.Application.Authentication.AuthService.SignInRequired
            );
        var (token, _) = await AccountAsync("origin@example.test");
        using var foreign = Search(token, new { query = "coffee" });
        foreign.Headers.Add("Origin", "https://attacker.example");
        using (var rejected = await Client.SendAsync(foreign, Ct))
            rejected.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        using var text = Authorized(HttpMethod.Post, SearchPath, bearer: token);
        text.Content = new StringContent("query=coffee");
        using (var notJson = await Client.SendAsync(text, Ct))
            await AuthTests.ShouldBeErrorAsync(
                notJson,
                HttpStatusCode.BadRequest,
                "Invalid search request."
            );
    }

    [Fact]
    public async Task whenSessionSearchesTooOften_SearchRateLimit_ShouldReturnTooManyRequests()
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Search:RateLimitPermits"] = "30" }
        );
        using var client = CreateClient(factory);
        var (token, _) = await AccountAsync("limited@example.test");
        var (other, _) = await AccountAsync("unlimited@example.test");
        for (var attempt = 0; attempt < SearchRateLimit.Permits; attempt++)
        {
            using var allowed = await client.SendAsync(Search(token, new { query = "x" }), Ct);
            allowed.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        using (var limited = await client.SendAsync(Search(token, new { query = "x" }), Ct))
        {
            await AuthTests.ShouldBeErrorAsync(
                limited,
                (HttpStatusCode)429,
                SearchRateLimit.Message
            );
            limited.Headers.RetryAfter.ShouldNotBeNull();
        }
        // The limit is per session.
        using var separate = await client.SendAsync(Search(other, new { query = "x" }), Ct);
        separate.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenStatementTimeoutFires_Search_ShouldReturnServiceUnavailableWithRetryAfter()
    {
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Backend:RequestTimeoutSeconds"] = "20",
                ["Database:CommandTimeoutSeconds"] = "10",
            }
        );
        using var client = CreateClient(factory);
        var (token, _) = await AccountAsync("slow@example.test");
        await SeedLedgerAsync(token);
        // An open transaction holding an exclusive lock makes every search statement
        // wait; the 2-second statement timeout cancels it.
        await using var blocker = await Fixture.Admin.OpenConnectionAsync(Ct);
        await using var transaction = await blocker.BeginTransactionAsync(Ct);
        await using (var lockTable = blocker.CreateCommand())
        {
            lockTable.Transaction = transaction;
            lockTable.CommandText = "LOCK TABLE penny.search_documents IN ACCESS EXCLUSIVE MODE";
            await lockTable.ExecuteNonQueryAsync(Ct);
        }
        var clock = Stopwatch.StartNew();
        using var response = await client.SendAsync(Search(token, new { query = "coffee" }), Ct);
        clock.Stop();
        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.ServiceUnavailable,
            PostgresSearchRepository.TimedOut
        );
        response.Headers.RetryAfter.ShouldNotBeNull();
        clock.Elapsed.ShouldBeGreaterThan(TimeSpan.FromSeconds(1.5));
        clock.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(10));
        await transaction.RollbackAsync(Ct);
        (await client.SendAsync(Search(token, new { query = "coffee" }), Ct)).StatusCode.ShouldBe(
            HttpStatusCode.OK
        );
    }

    [Fact]
    public async Task whenWorkerRuns_EmbeddingOutbox_ShouldMakeWritesSearchableByMeaningWithinTenSeconds()
    {
        var (token, _) = await AccountAsync("worker@example.test");
        await SeedLedgerAsync(token);
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Search:EmbeddingWorker"] = "true" }
        );
        factory.StartServer();
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(10))
        {
            if (
                (await SearchAsync(token, new { query = "beverage" })) is var page
                && Keys(page).Contains("personal:s01")
            )
            {
                MatchOf(page, "personal:s01").ShouldBe("meaning");
                (
                    await CountAsync(
                        "SELECT count(*) FROM penny.search_documents WHERE embedding_due_at IS NOT NULL"
                    )
                ).ShouldBe(0);
                return;
            }
            await Task.Delay(200, Ct);
        }
        throw new ShouldAssertException("The embedding worker did not catch up within 10 seconds.");
    }

    [Fact]
    public async Task whenSearching_Logs_ShouldNeverContainSearchText()
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
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(logs);
            }
        );
        using var client = CreateClient(factory);
        var (token, _) = await AccountAsync("quiet@example.test");
        await SeedLedgerAsync(token);
        const string secret = "Zanzibarquokka";
        using (
            var found = await client.SendAsync(
                Search(token, new { query = secret, from = "2026-01-01" }),
                Ct
            )
        )
            found.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (
            var invalid = await client.SendAsync(
                Search(token, new { query = secret, pageSize = 0 }),
                Ct
            )
        )
            invalid.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        logs.Messages.ShouldNotBeEmpty();
        logs.Messages.ShouldAllBe(message =>
            !message.Contains(secret, StringComparison.OrdinalIgnoreCase)
            && !message.Contains("zanzibar", StringComparison.OrdinalIgnoreCase)
        );
    }
}
