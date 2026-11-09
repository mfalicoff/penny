using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Search;
using Penny.Backend.Domain.Search;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Repositories;
using Pgvector.Npgsql;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Performance evidence for docs/migration/search.md (explicit: run with
// `--filter-class *SearchBenchmarkTests --explicit on`). Seeds 100,000 synthetic personal
// entries for one viewer plus shared expenses, backfills documents and embeddings
// with `search-rebuild`'s code path, measures p95 latencies through HTTP and records
// EXPLAIN (ANALYZE, BUFFERS) plans via auto_explain. Results go to
// .cache/search-benchmark.txt; nothing is committed.
public sealed class SearchBenchmarkTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private const int Entries = 100_000;
    private const int SharedExpenses = 2_000;
    private const int Runs = 40;

    private static readonly string[] Titles =
    [
        "Coffee beans",
        "Groceries",
        "Rent",
        "Loyer",
        "Bus pass",
        "Pharmacie",
        "Gas station",
        "Dinner at restaurant",
        "Boulangerie",
        "Netflix subscription",
        "Hydro-Québec",
        "Internet",
        "Phone bill",
        "Movie tickets",
        "Hardware store",
        "Bookstore",
        "Taxi",
        "Train ticket",
        "Parking",
        "Gym membership",
        "Dentist",
        "Haircut",
        "Pet food",
        "Insurance",
        "Clothing",
        "Shoes",
        "Gift",
        "Concert",
        "Bakery",
        "Farmers market",
        "Épicerie",
        "Dépanneur",
        "Pizza",
        "Sushi",
        "Lunch",
        "Breakfast",
        "Car repair",
        "Electricity",
        "Water bill",
        "Espresso machine",
    ];

    [Fact(Explicit = true)]
    public async Task whenHundredThousandEntriesSearched_Search_ShouldMeetLatencyTargets()
    {
        var report = new StringBuilder();
        var (token, userId) = await AccountAsync("benchmark@example.test");
        var (other, otherId) = await AccountAsync("benchmark-other@example.test");
        await SeedLedgerAsync(token);
        At(Noon);
        var home = Id(await CreateHouseholdAsync(token));
        await AdmitAsync(home, token, other);
        var seed = Stopwatch.StartNew();
        await Fixture.SqlAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                DELETE FROM penny.search_documents;
                DELETE FROM penny.ledger_entries WHERE user_id = '{userId}';
                INSERT INTO penny.ledger_entries (user_id, id, title, kind, total_cents, share_cents, category_id, account_id, trip_id, entry_date, note, receipt_id, recurring_id)
                SELECT '{userId}', 'b' || i,
                       (ARRAY[{string.Join(
                    ",",
                    Titles.Select(title => "'" + title + "'")
                )}])[1 + (i * 7919) % {Titles.Length}] || ' #' || (i % 997),
                       CASE WHEN i % 50 = 0 THEN 'income' WHEN i % 97 = 0 THEN 'investment' ELSE 'expense' END,
                       100 + (i * 37) % 50000, 100 + (i * 37) % 50000,
                       CASE WHEN i % 50 = 0 THEN 'salary' WHEN i % 97 = 0 THEN 'invest' ELSE (ARRAY['food','home','health','transport'])[1 + i % 4] END,
                       CASE WHEN i % 3 = 0 THEN 'card' END, NULL,
                       DATE '2016-01-01' + (i % 3900), CASE WHEN i % 5 = 0 THEN 'note ' || (i % 101) ELSE '' END, NULL, NULL
                FROM generate_series(1, {Entries}) AS i;
                INSERT INTO penny.household_expenses (id, household_id, title, total_cents, expense_date, payer_id, split_mode, category_name, category_icon, category_color, note, revision, created_by, created_at, updated_by, updated_at)
                SELECT 'x' || i, '{home}', (ARRAY[{string.Join(
                    ",",
                    Titles.Select(title => "'" + title + "'")
                )}])[1 + i % {Titles.Length}], 2000, DATE '2024-01-01' + (i % 900),
                       CASE WHEN i % 2 = 0 THEN '{userId}' ELSE '{otherId}' END, 'equal', 'Groceries', 'basket-outline', '#6C9C79', '', 0, '{userId}', now(), '{userId}', now()
                FROM generate_series(1, {SharedExpenses}) AS i;
                INSERT INTO penny.household_splits (expense_id, user_id, amount_cents)
                SELECT 'x' || i, u, 1000 FROM generate_series(1, {SharedExpenses}) AS i, unnest(ARRAY['{userId}', '{otherId}']) AS u;
                ANALYZE;
                """
            ),
            Ct
        );
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Seeded {Entries} entries and {SharedExpenses} shared expenses in {seed.Elapsed.TotalSeconds:F1} s"
        );

        // Maintenance runs with the command's 30-second statement bound, as search-rebuild does.
        await using var maintenance = Penny
            .Backend.Persistence.Configuration.DatabaseSettings.Create(
                Fixture.RuntimeConnection,
                maxPoolSize: 2,
                commandTimeoutSeconds: 30
            )
            .CreateDataSource();
        var repository = new PostgresSearchRepository(maintenance, Fixture.Receipts);
        var embedder = Fixture.Factory.Services.GetRequiredService<ITextEmbedder>();
        var rebuild = Stopwatch.StartNew();
        var rebuilt = await repository.RebuildAsync(null, embedder.ModelId, Ct);
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Text rebuild: {rebuilt.Written} documents in {rebuild.Elapsed.TotalSeconds:F1} s"
        );
        var backfill = Stopwatch.StartNew();
        var embedded = await new SearchEmbeddingService(
            repository,
            embedder,
            TimeProvider.System
        ).CatchUpAsync(Ct);
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Embedding backfill: {embedded} documents in {backfill.Elapsed.TotalSeconds:F1} s ({backfill.Elapsed.TotalMilliseconds / Math.Max(embedded, 1):F2} ms each)"
        );
        await Fixture.SqlAsync("VACUUM ANALYZE penny.search_documents", Ct);
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Table + indexes: {await ScalarAsync("SELECT pg_size_pretty(pg_total_relation_size('penny.search_documents'))")}, HNSW: {await ScalarAsync("SELECT pg_size_pretty(pg_relation_size('penny.ix_search_documents_embedding'))")}"
        );
        var queryEmbed = Stopwatch.StartNew();
        for (var i = 0; i < 50; i++)
            embedder.EmbedQuery(SearchText.Normalize("coffee beans " + i));
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Query embedding: {queryEmbed.Elapsed.TotalMilliseconds / 50:F1} ms each"
        );

        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Database:CommandTimeoutSeconds"] = "10",
                ["Backend:RequestTimeoutSeconds"] = "30",
            }
        );
        using var client = CreateClient(factory);
        var cases = new (string Name, object Body)[]
        {
            ("selective title (\"espresso machine #5\")", new { query = "espresso machine #5" }),
            ("selective typo (\"esspresso\")", new { query = "esspresso" }),
            ("common word (\"coffee\")", new { query = "coffee" }),
            ("meaning (\"beverage\")", new { query = "beverage" }),
            ("short (\"a\")", new { query = "a" }),
            ("broad: empty query, all time, count", new { }),
            ("broad: empty query, amount-desc", new { sort = "amount-desc" }),
            (
                "filtered: \"lunch\" in 2024, expense",
                new
                {
                    query = "lunch",
                    from = "2024-01-01",
                    to = "2024-12-31",
                    kind = "expense",
                }
            ),
        };
        report.AppendLine();
        report.AppendLine(
            "| Query | Results | Cold (ms) | Warm p50 (ms) | Warm p95 (ms) | p95 with concurrent writes (ms) |"
        );
        report.AppendLine("| --- | --- | --- | --- | --- | --- |");
        foreach (var (name, body) in cases)
        {
            var cold = await TimeAsync(client, token, body);
            var warm = new List<double>();
            long total = 0;
            for (var run = 0; run < Runs; run++)
            {
                var (elapsed, count) = await TimeWithCountAsync(client, token, body);
                warm.Add(elapsed);
                total = count;
            }
            using var writes = new CancellationTokenSource();
            var writer = WriteContinuouslyAsync(home, token, userId, writes.Token);
            var busy = new List<double>();
            for (var run = 0; run < Runs / 2; run++)
                busy.Add(await TimeAsync(client, token, body));
            await writes.CancelAsync();
            await writer;
            report.AppendLine(
                CultureInfo.InvariantCulture,
                $"| {name} | {total} | {cold:F0} | {Percentile(warm, 0.5):F0} | {Percentile(warm, 0.95):F0} | {Percentile(busy, 0.95):F0} |"
            );
        }

        report.AppendLine();
        report.AppendLine(
            "EXPLAIN (ANALYZE, BUFFERS) via auto_explain (same repository code, superuser session):"
        );
        var builder = new NpgsqlDataSourceBuilder(
            new NpgsqlConnectionStringBuilder(Fixture.AdminConnection)
            {
                Options = "-c session_preload_libraries=auto_explain",
                // Keep the session settings below when a connection returns to the pool.
                NoResetOnClose = true,
            }.ConnectionString
        );
        builder.UseVector();
        // Session settings on every physical connection; plans go to the server log.
        builder.UsePhysicalConnectionInitializer(
            _ => throw new NotSupportedException(),
            async connection =>
            {
                await using var set = connection.CreateCommand();
                set.CommandText =
                    "SET auto_explain.log_min_duration = 0; SET auto_explain.log_analyze = on; SET auto_explain.log_buffers = on; SET auto_explain.log_timing = on";
                await set.ExecuteNonQueryAsync();
            }
        );
        await using var explained = builder.Build();
        var explaining = new PostgresSearchRepository(explained, Fixture.Receipts);
        foreach (var query in new[] { "espresso machine #5", "coffee", "beverage", "a", "" })
        {
            var request = SearchReader.Read(
                System.Text.Json.JsonSerializer.SerializeToElement(new { query })
            );
            await explaining.SearchAsync(
                new SearchCriteria(
                    userId,
                    request,
                    null,
                    51,
                    SearchText.HasLetterOrDigit(request.Query)
                        ? embedder.EmbedQuery(request.Query)
                        : null,
                    embedder.ModelId
                ),
                Ct
            );
        }
        // The container log stream lags behind the server.
        await Task.Delay(TimeSpan.FromSeconds(5), Ct);
        var log = await Fixture.ServerLogAsync();
        report.AppendLine(log[log.IndexOf("duration:", StringComparison.Ordinal)..]);
        var path = Path.Combine(
            Path.GetDirectoryName(SearchModel.Directory)!,
            "..",
            "search-benchmark.txt"
        );
        await File.WriteAllTextAsync(path, report.ToString(), Ct);
        embedded.ShouldBe(Entries + SharedExpenses);
    }

    private async Task WriteContinuouslyAsync(
        string home,
        string token,
        string userId,
        CancellationToken stop
    )
    {
        try
        {
            while (!stop.IsCancellationRequested)
            {
                using var created = await SendAsync(
                    HttpMethod.Post,
                    ExpensesPath(home),
                    token,
                    Expense(1500, userId, "2026-10-01", new { title = "Concurrent write" })
                );
                created.StatusCode.ShouldBe(HttpStatusCode.Created);
            }
        }
        catch (OperationCanceledException) { }
    }

    private static async Task<double> TimeAsync(HttpClient client, string token, object body) =>
        (await TimeWithCountAsync(client, token, body)).Elapsed;

    private static async Task<(double Elapsed, long Count)> TimeWithCountAsync(
        HttpClient client,
        string token,
        object body
    )
    {
        using var request = Authorized(HttpMethod.Post, SearchPath, bearer: token);
        request.Content = System.Net.Http.Json.JsonContent.Create(body);
        var clock = Stopwatch.StartNew();
        using var response = await client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        clock.Stop();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        using var json = System.Text.Json.JsonDocument.Parse(text);
        return (
            clock.Elapsed.TotalMilliseconds,
            json.RootElement.GetProperty("totalCount").GetInt64()
        );
    }

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.Order().ToList();
        return sorted[(int)Math.Ceiling(percentile * sorted.Count) - 1];
    }
}
