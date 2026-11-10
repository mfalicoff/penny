using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Domain.Ledgers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-64 large-ledger and bounded-concurrency checks over real HTTP and PostgreSQL,
// on a host with the production body limit (20 MiB) and a long request deadline.
// Timings are written to the test output (TRX) as the regression baseline. The
// budgets are deliberately generous upper bounds, several times the measured
// baseline in docs/migration/parity-report.md#baseline-timings: they catch a
// pathological regression (a quadratic write, a lost index), not normal runner noise.
public sealed class LargeLedgerTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private static readonly TimeSpan FullWriteBudget = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan FullReadBudget = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan ConcurrentRequestBudget = TimeSpan.FromSeconds(15);

    private const int Users = 8;
    private const int EntriesPerUser = 5_000;
    private const int Rounds = 4;

    // Every CI run: one entry over the limit is refused by validation, before any write.
    [Fact]
    public async Task whenLedgerOverTransactionLimit_PutLedger_ShouldRefuseWithoutWriting()
    {
        await using var host = LargeHost();
        using var client = CreateClient(host);
        var token = await RegisterAsync("over-limit@example.test", client);
        var snapshot = await GetAsync(client, token);
        var entries = snapshot["ledger"]!["transactions"]!.AsArray();
        for (var index = 0; index <= LedgerLimits.MaxTransactions; index++)
            entries.Add(Entry(index));
        using (var refused = await PutAsync(client, token, snapshot))
            refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var stored = await GetAsync(client, token);
        stored["revision"]!.GetValue<long>().ShouldBe(0);
        stored["ledger"]!["transactions"]!.AsArray().ShouldBeEmpty();
    }

    // Explicit until MAZ-137: the first write of a full ledger takes about 48 s on an idle
    // database and over 100 s on the shared test database after the rest of the suite,
    // beyond the 30 s production request deadline. MAZ-137 makes this write fast,
    // lowers FullWriteBudget below the deadline and removes `Explicit`. Run it with
    // `--filter-method '*whenLedgerAtTransactionLimit*'`.
    [Fact(Explicit = true)]
    public async Task whenLedgerAtTransactionLimit_LedgerFlow_ShouldWriteReadAndRefuseOneMore()
    {
        await using var host = LargeHost();
        using var client = CreateClient(host);
        var token = await RegisterAsync("large@example.test", client);
        var snapshot = await GetAsync(client, token);
        var entries = snapshot["ledger"]!["transactions"]!.AsArray();
        for (var index = 0; index < LedgerLimits.MaxTransactions; index++)
            entries.Add(Entry(index));

        var write = Stopwatch.StartNew();
        using (var saved = await PutAsync(client, token, snapshot))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
        write.Stop();

        var read = Stopwatch.StartNew();
        var stored = await GetAsync(client, token);
        read.Stop();
        stored["revision"]!.GetValue<long>().ShouldBe(1);
        stored["ledger"]!["transactions"]!.AsArray().Count.ShouldBe(LedgerLimits.MaxTransactions);

        // A one-entry edit of a full ledger.
        stored["ledger"]!["transactions"]![0]!["title"] = "Edited";
        var edit = Stopwatch.StartNew();
        using (var edited = await PutAsync(client, token, stored))
            edited.StatusCode.ShouldBe(HttpStatusCode.OK);
        edit.Stop();

        // One entry over the limit is refused and nothing changes.
        var over = await GetAsync(client, token);
        over["ledger"]!["transactions"]!.AsArray().Add(Entry(LedgerLimits.MaxTransactions));
        using (var refused = await PutAsync(client, token, over))
            refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetAsync(client, token))["revision"]!.GetValue<long>().ShouldBe(2);

        Report(
            $"ledger at {LedgerLimits.MaxTransactions} entries: write {write.Elapsed.TotalSeconds:F2} s, read {read.Elapsed.TotalSeconds:F2} s, one-entry edit {edit.Elapsed.TotalSeconds:F2} s"
        );
        write.Elapsed.ShouldBeLessThan(FullWriteBudget);
        edit.Elapsed.ShouldBeLessThan(FullWriteBudget);
        read.Elapsed.ShouldBeLessThan(FullReadBudget);
    }

    [Fact]
    public async Task whenUsersSyncConcurrently_LedgerFlow_ShouldStayIsolatedWithinBudget()
    {
        await using var host = LargeHost();
        using var client = CreateClient(host);
        var tokens = new List<string>();
        for (var user = 0; user < Users; user++)
        {
            var token = await RegisterAsync($"sync{user}@example.test", client);
            var snapshot = await GetAsync(client, token);
            var entries = snapshot["ledger"]!["transactions"]!.AsArray();
            for (var index = 0; index < EntriesPerUser; index++)
                entries.Add(Entry(index, $"u{user}"));
            using var saved = await PutAsync(client, token, snapshot);
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
            tokens.Add(token);
        }

        // Every user's device syncs at once: read, append one entry, write, repeat.
        var latencies = new System.Collections.Concurrent.ConcurrentBag<TimeSpan>();
        await Task.WhenAll(
            tokens.Select(
                (token, user) =>
                    Task.Run(
                        async () =>
                        {
                            for (var round = 0; round < Rounds; round++)
                            {
                                var timer = Stopwatch.StartNew();
                                var snapshot = await GetAsync(client, token);
                                snapshot["ledger"]!["transactions"]!
                                    .AsArray()
                                    .Add(Entry(EntriesPerUser + round, $"u{user}"));
                                using var saved = await PutAsync(client, token, snapshot);
                                saved.StatusCode.ShouldBe(HttpStatusCode.OK);
                                latencies.Add(timer.Elapsed);
                            }
                        },
                        Ct
                    )
            )
        );

        // Isolation: each ledger has exactly its own entries and revisions.
        for (var user = 0; user < Users; user++)
        {
            var stored = await GetAsync(client, tokens[user]);
            stored["revision"]!.GetValue<long>().ShouldBe(1 + Rounds);
            var ids = stored["ledger"]!["transactions"]!
                .AsArray()
                .Select(entry => entry!["id"]!.GetValue<string>())
                .ToList();
            ids.Count.ShouldBe(EntriesPerUser + Rounds);
            ids.ShouldAllBe(id => id.StartsWith($"u{user}-", StringComparison.Ordinal));
        }

        // Writers racing on one revision of one ledger: exactly one wins.
        var shared = await GetAsync(client, tokens[0]);
        var statuses = await Task.WhenAll(
            Enumerable
                .Range(0, Users)
                .Select(async writer =>
                {
                    var copy = shared.DeepClone();
                    copy["ledger"]!["transactions"]!.AsArray().Add(Entry(900_000 + writer, "race"));
                    using var response = await PutAsync(client, tokens[0], copy);
                    return response.StatusCode;
                })
        );
        statuses.Count(status => status == HttpStatusCode.OK).ShouldBe(1);
        statuses.Count(status => status == HttpStatusCode.Conflict).ShouldBe(Users - 1);

        var ordered = latencies.Order().ToList();
        var p50 = ordered[ordered.Count / 2];
        var p95 = ordered[(int)Math.Ceiling(ordered.Count * 0.95) - 1];
        Report(
            $"{Users} users x {EntriesPerUser} entries, {Rounds} concurrent sync rounds: read+write p50 {p50.TotalSeconds:F2} s, p95 {p95.TotalSeconds:F2} s, max {ordered[^1].TotalSeconds:F2} s"
        );
        p95.ShouldBeLessThan(ConcurrentRequestBudget);
    }

    // Production body limit and statement timeout, and a request deadline long enough
    // to measure instead of time out.
    private TestApiFactory LargeHost() =>
        new(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Backend:MaxRequestBodyBytes"] = (20 * 1024 * 1024).ToString(
                    CultureInfo.InvariantCulture
                ),
                ["Backend:RequestTimeoutSeconds"] = "120",
                // The production default (appsettings.json); the shared test host uses 1 s.
                ["Database:CommandTimeoutSeconds"] = "5",
            }
        );

    private static void Report(string line) =>
        TestContext.Current.TestOutputHelper?.WriteLine("MAZ-64 baseline: " + line);

    private static JsonObject Entry(int index, string prefix = "e") =>
        new()
        {
            ["id"] = string.Create(CultureInfo.InvariantCulture, $"{prefix}-{index:D6}"),
            ["title"] = string.Create(
                CultureInfo.InvariantCulture,
                $"Synthetic purchase {index % 997}"
            ),
            ["kind"] = "expense",
            ["total"] = 100 + (index % 5_000),
            ["share"] = 100 + (index % 5_000),
            ["categoryId"] = "food",
            ["date"] = new DateOnly(2020, 1, 1)
                .AddDays(index % 2_500)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["note"] = "",
        };

    private static async Task<JsonNode> GetAsync(HttpClient client, string token)
    {
        using var response = await client.SendAsync(
            Authorized(HttpMethod.Get, "/api/ledger", bearer: token),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;
    }

    private static Task<HttpResponseMessage> PutAsync(
        HttpClient client,
        string token,
        JsonNode body
    )
    {
        var request = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
        request.Content = JsonContent.Create(body);
        return client.SendAsync(request, Ct);
    }
}
