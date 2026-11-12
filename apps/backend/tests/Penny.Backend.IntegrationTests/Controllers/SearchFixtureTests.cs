using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// The shared contract fixtures (contracts/fixtures/search-cases.json) against real
// PostgreSQL with pg_trgm and pgvector and the real multilingual model.
public sealed class SearchFixtureTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private async Task<string> SeededAsync()
    {
        var (token, _) = await AccountAsync("search-fixture@example.test");
        await SeedLedgerAsync(token);
        await CatchUpAsync();
        return token;
    }

    [Fact]
    public async Task whenLexicalFixturesRun_Search_ShouldReturnExpectedOrderTiersAndCounts()
    {
        var token = await SeededAsync();
        foreach (var item in Cases["lexicalCases"]!.AsArray())
        {
            var name = item!["name"]!.GetValue<string>();
            var page = await SearchAsync(token, item["request"]!);
            var keys = Keys(page);
            if (item["keysPrefix"] is JsonArray ordered)
            {
                var expected = ordered.Select(key => key!.GetValue<string>()).ToList();
                keys.Where(expected.Contains).ToList().ShouldBe(expected, name);
                continue;
            }
            var expectedKeys = item["keys"]!
                .AsArray()
                .Select(key => key!.GetValue<string>())
                .ToList();
            keys.Take(expectedKeys.Count).ToList().ShouldBe(expectedKeys, name);
            if (item["matches"] is JsonArray matches)
                Matches(page)
                    .Take(expectedKeys.Count)
                    .ToList()
                    .ShouldBe(matches.Select(match => match?.GetValue<string>()).ToList(), name);
            if (item["meaningAllowedAfter"]?.GetValue<bool>() == true)
                Matches(page)
                    .Skip(expectedKeys.Count)
                    .ShouldAllBe(match => match == "meaning", name);
            else
                keys.Count.ShouldBe(expectedKeys.Count, name);
            if (item["totalCount"] is { } total)
                Total(page).ShouldBe(total.GetValue<long>(), name);
        }
    }

    [Fact]
    public async Task whenMeaningFixturesRun_Search_ShouldFindEnglishFrenchAndMixedMeanings()
    {
        var token = await SeededAsync();
        foreach (var item in Cases["meaningCases"]!.AsArray())
        {
            var name = item!["name"]!.GetValue<string>();
            var page = await SearchAsync(token, item["request"]!);
            if (item["includes"] is JsonArray includes)
                foreach (var key in includes.Select(key => key!.GetValue<string>()))
                {
                    Keys(page).ShouldContain(key, name);
                    MatchOf(page, key).ShouldBe("meaning", name);
                }
            if (item["alsoIncludes"] is JsonArray anyTier)
                foreach (var key in anyTier.Select(key => key!.GetValue<string>()))
                    Keys(page).ShouldContain(key, name);
            if (item["keys"] is JsonArray exact)
                Keys(page).ShouldBe([.. exact.Select(key => key!.GetValue<string>())], name);
        }
    }

    // MAZ-167: short entries embed generically, so unrelated or nonsense queries scored
    // above a fixed threshold; the per-query baseline keeps them out.
    [Fact]
    public async Task whenQueryUnrelatedToShortEntries_Search_ShouldReturnNoMeaningMatches()
    {
        var (token, _) = await AccountAsync("search-unrelated@example.test");
        await SeedLedgerAsync(token, Cases["unrelatedLedger"]);
        await CatchUpAsync();
        foreach (var item in Cases["unrelatedCases"]!.AsArray())
        {
            var name = item!["name"]!.GetValue<string>();
            var page = await SearchAsync(token, item["request"]!);
            if (item["includes"] is JsonArray includes)
                foreach (var key in includes.Select(key => key!.GetValue<string>()))
                    MatchOf(page, key).ShouldBe("meaning", name);
            if (item["keys"] is JsonArray exact)
            {
                Keys(page).ShouldBe([.. exact.Select(key => key!.GetValue<string>())], name);
                Total(page).ShouldBe(exact.Count, name);
            }
        }
    }

    [Fact]
    public async Task whenPagesFollowed_Search_ShouldReturnEveryResultOnceInOrder()
    {
        var token = await SeededAsync();
        var pagination = Cases["paginationCase"]!;
        var request = (JsonObject)pagination["request"]!.DeepClone();
        var paged = await AllPagesAsync(token, request);
        request["pageSize"] = 100;
        var whole = Keys(await SearchAsync(token, request));
        paged.ShouldBe(whole);
        paged.Distinct().Count().ShouldBe(paged.Count);
        paged
            .Take(3)
            .ShouldBe([
                .. pagination["lexicalKeys"]!.AsArray().Select(key => key!.GetValue<string>()),
            ]);
        // Every sort paginates consistently, including amount ties.
        foreach (var sort in new[] { "date-desc", "date-asc", "amount-desc", "amount-asc" })
        {
            var all = new JsonObject { ["sort"] = sort, ["pageSize"] = 100 };
            var expected = Keys(await SearchAsync(token, all));
            all["pageSize"] = 3;
            (await AllPagesAsync(token, all)).ShouldBe(expected, sort);
        }
    }

    [Fact]
    public async Task whenRequestInvalid_Search_ShouldReturnBadRequest()
    {
        var (token, _) = await AccountAsync("search-invalid@example.test");
        foreach (var item in Cases["invalidRequests"]!.AsArray())
            await ExpectErrorAsync(
                HttpMethod.Post,
                SearchPath,
                token,
                HttpStatusCode.BadRequest,
                "Invalid search request.",
                item
            );
        foreach (var item in Cases["requests"]!.AsArray().Where(item => item!["cursor"] is null))
            await SearchAsync(token, item!);
    }

    [Fact]
    public async Task whenCursorTamperedOrReused_Search_ShouldRejectIt()
    {
        var token = await SeededAsync();
        var first = await SearchAsync(token, new { query = "coffee", pageSize = 1 });
        var cursor = first.GetProperty("nextCursor").GetString()!;
        await ExpectErrorAsync(
            HttpMethod.Post,
            SearchPath,
            token,
            HttpStatusCode.BadRequest,
            "Invalid search cursor.",
            new
            {
                query = "coffees",
                pageSize = 1,
                cursor,
            }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            SearchPath,
            token,
            HttpStatusCode.BadRequest,
            "Invalid search cursor.",
            new
            {
                query = "coffee",
                sort = "date-desc",
                cursor,
            }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            SearchPath,
            token,
            HttpStatusCode.BadRequest,
            "Invalid search cursor.",
            new { query = "coffee", cursor = "not-a-cursor" }
        );
        // The page size is not bound; the same query continues.
        var second = await SearchAsync(
            token,
            new
            {
                query = " Coffee ",
                pageSize = 2,
                cursor,
            }
        );
        Keys(second).First().ShouldBe("personal:s02");
    }

    [Fact]
    public async Task whenSearching_Response_ShouldUseTheEntryContract()
    {
        var token = await SeededAsync();
        var page = await SearchAsync(token, new { query = "travel card" });
        page.GetProperty("version").GetInt32().ShouldBe(1);
        var item = page.GetProperty("items")[0];
        item.GetProperty("source").GetString().ShouldBe("personal");
        var entry = item.GetProperty("entry");
        entry.GetProperty("id").GetString().ShouldBe("s01");
        entry.GetProperty("total").GetInt64().ShouldBe(1000);
        entry.GetProperty("share").GetInt64().ShouldBe(500);
        entry.GetProperty("accountId").GetString().ShouldBe("card");
        entry.GetProperty("date").GetString().ShouldBe("2026-11-02");
        (await SearchAsync(token, new { }))
            .GetProperty("items")[0]
            .GetProperty("match")
            .ValueKind.ShouldBe(JsonValueKind.Null);
    }
}
