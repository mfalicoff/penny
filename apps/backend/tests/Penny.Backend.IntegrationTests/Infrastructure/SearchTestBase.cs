using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Search;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the search suites (MAZ-121). The shared host runs no embedding
// worker; tests drain the embedding outbox explicitly with the real model.
public abstract class SearchTestBase(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    protected const string SearchPath = "/api/v1/search/transactions";

    protected static JsonNode Cases => ContractFixtures.Read("search-cases.json");

    protected Task<JsonElement> SearchAsync(string token, object body) =>
        ExpectAsync(HttpMethod.Post, SearchPath, token, HttpStatusCode.OK, body);

    protected Task<long> CatchUpAsync(WebApplicationFactory<Program>? factory = null) =>
        (factory ?? Fixture.Factory)
            .Services.GetRequiredService<SearchEmbeddingService>()
            .CatchUpAsync(Ct);

    // Replaces the user's ledger with the fixture's server ledger.
    protected async Task SeedLedgerAsync(string token, JsonNode? ledger = null)
    {
        var snapshot = await GetLedgerAsync(token);
        snapshot["ledger"] = (ledger ?? Cases["serverLedger"]!).DeepClone();
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
    }

    protected async Task SaveLedgerAsync(string token, Action<JsonNode> change)
    {
        var snapshot = await GetLedgerAsync(token);
        change(snapshot["ledger"]!);
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
    }

    protected static List<string> Keys(JsonElement page) =>
        [
            .. page.GetProperty("items")
                .EnumerateArray()
                .Select(item => item.GetProperty("key").GetString()!),
        ];

    protected static List<string?> Matches(JsonElement page) =>
        [
            .. page.GetProperty("items")
                .EnumerateArray()
                .Select(item => item.GetProperty("match").GetString()),
        ];

    protected static string? MatchOf(JsonElement page, string key) =>
        page.GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == key)
            .GetProperty("match")
            .GetString();

    protected static long Total(JsonElement page) => page.GetProperty("totalCount").GetInt64();

    // Follows nextCursor to the end; returns every key in order.
    protected async Task<List<string>> AllPagesAsync(string token, JsonObject request)
    {
        var keys = new List<string>();
        string? cursor = null;
        for (var page = 0; page < 50; page++)
        {
            var body = (JsonObject)request.DeepClone();
            if (cursor is not null)
                body["cursor"] = cursor;
            var result = await SearchAsync(token, body);
            keys.AddRange(Keys(result));
            var next = result.GetProperty("nextCursor");
            if (next.ValueKind == JsonValueKind.Null)
                return keys;
            cursor = next.GetString();
        }
        throw new ShouldAssertException("Pagination did not end.");
    }
}
